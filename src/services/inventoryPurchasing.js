const crypto = require('node:crypto');
const { pool } = require('../config/db');
const { applyDocument, toUnits, fromUnits } = require('./inventoryMovement');

function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
const documentKey = value => `purchase:${crypto.createHash('sha256').update(String(value)).digest('hex')}`;
const folio = prefix => `${prefix}-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

async function validateOrderReferences(db, input) {
  const [supplier] = await db.query(`SELECT p.id FROM inv_proveedor p JOIN inv_proveedor_sucursal ps ON ps.proveedor_id=p.id
    WHERE p.id=? AND ps.sucursal_id=? AND p.activo=1 FOR UPDATE`, [input.proveedor_id,input.sucursal_id]);
  if (!supplier.length) fail('El proveedor no está activo para esta sucursal.');
  const [warehouse] = await db.query('SELECT id FROM inv_almacen WHERE id=? AND sucursal_id=? AND activo=1 FOR UPDATE', [input.almacen_id,input.sucursal_id]);
  if (!warehouse.length) fail('El almacén no pertenece a la sucursal o está inactivo.');
  const seen = new Set();
  let subtotal = 0n;
  for (const [index,line] of input.detalles.entries()) {
    if (seen.has(line.producto_id)) fail('Un artículo no puede repetirse en la orden.');
    seen.add(line.producto_id);
    const [product] = await db.query(`SELECT p.id FROM inv_producto p JOIN inv_producto_almacen pa ON pa.producto_id=p.id
      WHERE p.id=? AND pa.almacen_id=? AND pa.sucursal_id=? AND p.activo=1 FOR UPDATE`, [line.producto_id,input.almacen_id,input.sucursal_id]);
    if (!product.length) fail(`Partida ${index + 1}: el artículo no está configurado en el almacén.`);
    subtotal += toUnits(line.cantidad) * toUnits(line.costo_esperado) / 1000000n;
  }
  return fromUnits(subtotal);
}

async function saveDraftOrder(input, userId, orderId = null) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const subtotal = await validateOrderReferences(db,input);
    let id = orderId;
    let orderFolio;
    if (orderId) {
      const [rows] = await db.query('SELECT * FROM inv_orden_compra WHERE id=? FOR UPDATE', [orderId]);
      if (!rows.length) fail('La orden de compra no existe.',404);
      if (rows[0].estado !== 'BORRADOR') fail('Solo se puede editar una orden en borrador.',409);
      if (Number(rows[0].sucursal_id) !== Number(input.sucursal_id)) fail('No se puede cambiar la sucursal de la orden.');
      orderFolio = rows[0].folio;
      await db.query(`UPDATE inv_orden_compra SET almacen_id=?,proveedor_id=?,fecha_estimada=?,condiciones_pago=?,notas=?,subtotal_estimado=? WHERE id=?`,
        [input.almacen_id,input.proveedor_id,input.fecha_estimada || null,input.condiciones_pago || null,input.notas || null,subtotal,orderId]);
      await db.query('DELETE FROM inv_orden_compra_detalle WHERE orden_compra_id=?', [orderId]);
    } else {
      orderFolio = folio('OC');
      const [created] = await db.query(`INSERT INTO inv_orden_compra(folio,sucursal_id,almacen_id,proveedor_id,fecha_estimada,condiciones_pago,notas,subtotal_estimado,creado_por)
        VALUES (?,?,?,?,?,?,?,?,?)`, [orderFolio,input.sucursal_id,input.almacen_id,input.proveedor_id,input.fecha_estimada || null,input.condiciones_pago || null,input.notas || null,subtotal,userId]);
      id = Number(created.insertId);
    }
    await db.query('INSERT INTO inv_orden_compra_detalle(orden_compra_id,producto_id,cantidad_ordenada,costo_esperado) VALUES ?',
      [input.detalles.map(line => [id,line.producto_id,line.cantidad,line.costo_esperado])]);
    for (const line of input.detalles) await db.query(`INSERT INTO inv_producto_proveedor(producto_id,proveedor_id,sucursal_id,costo_referencia)
      VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE costo_referencia=VALUES(costo_referencia)`, [line.producto_id,input.proveedor_id,input.sucursal_id,line.costo_esperado]);
    await db.query(`INSERT INTO inv_auditoria(sucursal_id,usuario_id,accion,entidad,entidad_id,despues) VALUES (?,?,'${orderId ? 'ACTUALIZAR' : 'CREAR'}','inv_orden_compra',?,?)`,
      [input.sucursal_id,userId,id,JSON.stringify({ folio: orderFolio, estado: 'BORRADOR', subtotal_estimado: subtotal })]);
    await db.commit();
    return { id:Number(id),folio:orderFolio,estado:'BORRADOR',subtotal_estimado:subtotal };
  } catch (error) { await db.rollback(); if (error.code === 'ER_DUP_ENTRY') fail('La orden contiene datos duplicados.',409); throw error; } finally { db.release(); }
}

async function transitionOrder(orderId, action, userId, reason = null) {
  const rules = {
    solicitar: { from:['BORRADOR'], to:'PENDIENTE_AUTORIZACION', fields:'solicitado_at=UTC_TIMESTAMP(6)' },
    autorizar: { from:['PENDIENTE_AUTORIZACION'], to:'AUTORIZADA', fields:'autorizado_por=?,autorizado_at=UTC_TIMESTAMP(6)' },
    enviar: { from:['AUTORIZADA'], to:'ENVIADA', fields:'enviado_por=?,enviado_at=UTC_TIMESTAMP(6)' },
    rechazar: { from:['PENDIENTE_AUTORIZACION'], to:'RECHAZADA', fields:'cancelado_por=?,cancelado_at=UTC_TIMESTAMP(6),notas=CONCAT(COALESCE(notas,\'\'),?)' },
    cancelar: { from:['BORRADOR','PENDIENTE_AUTORIZACION','AUTORIZADA','ENVIADA'], to:'CANCELADA', fields:'cancelado_por=?,cancelado_at=UTC_TIMESTAMP(6),notas=CONCAT(COALESCE(notas,\'\'),?)' },
  };
  const rule = rules[action];
  if (!rule) fail('Acción de orden no permitida.');
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const [rows] = await db.query('SELECT * FROM inv_orden_compra WHERE id=? FOR UPDATE',[orderId]);
    if (!rows.length) fail('La orden de compra no existe.',404);
    const order=rows[0];
    if (!rule.from.includes(order.estado)) fail(`La orden no puede pasar de ${order.estado} a ${rule.to}.`,409);
    const params=[];
    if (['autorizar','enviar'].includes(action)) params.push(userId);
    if (['rechazar','cancelar'].includes(action)) params.push(userId,` | ${action}: ${reason}`);
    params.push(orderId);
    await db.query(`UPDATE inv_orden_compra SET estado='${rule.to}',${rule.fields} WHERE id=?`,params);
    await db.query(`INSERT INTO inv_auditoria(sucursal_id,usuario_id,accion,entidad,entidad_id,antes,despues) VALUES (?,?,?,?,?,?,?)`,
      [order.sucursal_id,userId,action.toUpperCase(),'inv_orden_compra',orderId,JSON.stringify({estado:order.estado}),JSON.stringify({estado:rule.to,motivo:reason})]);
    await db.commit(); return { id:Number(orderId),folio:order.folio,estado:rule.to };
  } catch(error){await db.rollback();throw error;} finally{db.release();}
}

async function receiveOrder(orderId, input, userId) {
  const db=await pool.getConnection();
  try {
    await db.beginTransaction();
    const [duplicate]=await db.query('SELECT id,folio FROM inv_recepcion_compra WHERE idempotencia=?',[input.idempotencia]);
    if(duplicate.length){await db.commit();return {id:Number(duplicate[0].id),folio:duplicate[0].folio,duplicated:true};}
    const [orders]=await db.query('SELECT * FROM inv_orden_compra WHERE id=? FOR UPDATE',[orderId]);
    if(!orders.length) fail('La orden de compra no existe.',404);
    const order=orders[0];
    if(!['ENVIADA','PARCIAL'].includes(order.estado)) fail('La orden debe estar enviada para poder recibirla.',409);
    const [location]=await db.query('SELECT id FROM inv_ubicacion WHERE id=? AND almacen_id=? AND sucursal_id=? AND activo=1 FOR UPDATE',[input.ubicacion_id,order.almacen_id,order.sucursal_id]);
    if(!location.length) fail('La ubicación de recepción no pertenece al almacén de la orden.');
    const ids=input.detalles.map(line=>line.orden_detalle_id);
    if(new Set(ids).size!==ids.length) fail('Una partida de la orden no puede repetirse en la recepción.');
    const [details]=await db.query(`SELECT * FROM inv_orden_compra_detalle WHERE orden_compra_id=? AND id IN (${ids.map(()=>'?').join(',')}) FOR UPDATE`,[orderId,...ids]);
    if(details.length!==ids.length) fail('Una partida no pertenece a la orden.');
    const byId=new Map(details.map(row=>[Number(row.id),row]));
    for(const [index,line] of input.detalles.entries()){
      const detail=byId.get(line.orden_detalle_id);
      if(toUnits(detail.cantidad_recibida)+toUnits(line.cantidad)>toUnits(detail.cantidad_ordenada)) fail(`Partida ${index+1}: la recepción supera la cantidad pendiente.`,409);
    }
    const inventory=await applyDocument({sucursal_id:order.sucursal_id,tipo:'ENTRADA',motivo:`Recepción de compra ${order.folio}`,
      referencia:input.factura_proveedor,idempotencia:documentKey(input.idempotencia),fecha_operacion:input.fecha_recepcion,
      detalles:input.detalles.map(line=>{const detail=byId.get(line.orden_detalle_id);return {producto_id:detail.producto_id,almacen_id:order.almacen_id,
        ubicacion_id:input.ubicacion_id,cantidad:line.cantidad,costo_unitario:line.costo_real};})},userId,db);
    const receiptFolio=folio('REC');
    const [receipt]=await db.query(`INSERT INTO inv_recepcion_compra(folio,orden_compra_id,sucursal_id,almacen_id,ubicacion_id,factura_proveedor,idempotencia,documento_inventario_id,recibido_por,fecha_recepcion)
      VALUES (?,?,?,?,?,?,?,?,?,?)`,[receiptFolio,orderId,order.sucursal_id,order.almacen_id,input.ubicacion_id,input.factura_proveedor,input.idempotencia,inventory.id,userId,input.fecha_recepcion?new Date(input.fecha_recepcion):new Date()]);
    for(const line of input.detalles){const detail=byId.get(line.orden_detalle_id);
      await db.query(`INSERT INTO inv_recepcion_compra_detalle(recepcion_id,orden_detalle_id,producto_id,cantidad,costo_esperado,costo_real) VALUES (?,?,?,?,?,?)`,
        [receipt.insertId,detail.id,detail.producto_id,line.cantidad,detail.costo_esperado,line.costo_real]);
      await db.query('UPDATE inv_orden_compra_detalle SET cantidad_recibida=cantidad_recibida+? WHERE id=?',[line.cantidad,detail.id]);
      await db.query(`INSERT INTO inv_producto_proveedor(producto_id,proveedor_id,sucursal_id,costo_referencia) VALUES (?,?,?,?)
        ON DUPLICATE KEY UPDATE costo_referencia=VALUES(costo_referencia)`,[detail.producto_id,order.proveedor_id,order.sucursal_id,line.costo_real]);
    }
    const [[pending]]=await db.query('SELECT COUNT(*) total FROM inv_orden_compra_detalle WHERE orden_compra_id=? AND cantidad_recibida<cantidad_ordenada',[orderId]);
    const state=Number(pending.total)===0?'RECIBIDA':'PARCIAL';
    await db.query(`UPDATE inv_orden_compra SET estado=?,completado_at=IF(?='RECIBIDA',UTC_TIMESTAMP(6),NULL) WHERE id=?`,[state,state,orderId]);
    await db.query(`INSERT INTO inv_auditoria(sucursal_id,usuario_id,accion,entidad,entidad_id,despues) VALUES (?,?,'RECIBIR','inv_recepcion_compra',?,?)`,
      [order.sucursal_id,userId,receipt.insertId,JSON.stringify({orden_compra_id:orderId,factura:input.factura_proveedor,estado_orden:state})]);
    await db.commit();return {id:Number(receipt.insertId),folio:receiptFolio,estado_orden:state,documento_inventario_id:inventory.id,duplicated:false};
  }catch(error){await db.rollback();if(error.code==='ER_DUP_ENTRY') fail('La recepción ya fue registrada.',409);throw error;}finally{db.release();}
}

module.exports={saveDraftOrder,transitionOrder,receiveOrder};
