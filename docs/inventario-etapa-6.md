# Inventario SEEP - etapa 6

Esta etapa agrega compras y proveedores al inventario independiente.

## Proveedores

El catálogo guarda razón social, nombre comercial, RFC, contacto, teléfono, correo, condiciones de pago, tiempo de entrega, calificación, notas, estado y sucursales atendidas. El administrador global administra el catálogo; los administradores de sucursal consultan proveedores disponibles para su sucursal.

Cada sucursal puede asociar productos al proveedor, conservar el SKU usado por este, un costo de referencia y marcar un proveedor preferido. Solo puede existir un proveedor preferido por producto y sucursal.

## Propuestas de compra

Las propuestas aparecen cuando la existencia agregada del almacén es menor o igual al punto de reorden. La cantidad sugerida es:

```text
stock máximo - existencia actual
```

La propuesta muestra proveedor preferido y costo de referencia cuando están configurados. Una propuesta no modifica inventario ni crea automáticamente una obligación; sirve para preparar el borrador de la orden.

## Flujo de la orden

```text
BORRADOR
  -> PENDIENTE_AUTORIZACION
  -> AUTORIZADA
  -> ENVIADA
  -> PARCIAL
  -> RECIBIDA
```

El administrador de sucursal crea, edita y solicita la orden. El administrador global autoriza, rechaza o cancela confirmando su contraseña. La sucursal puede marcar una orden autorizada como enviada y recibir mercancía.

Las órdenes rechazadas y canceladas conservan su historial. Solo los borradores pueden editarse.

## Recepciones

- Admiten cantidades parciales y varias facturas para una misma orden.
- Nunca permiten recibir más de lo ordenado.
- Requieren factura, ubicación, cantidad y costo real.
- Cada recepción genera una entrada trazable en el Kardex.
- El costo real actualiza el último costo y el promedio ponderado.
- La diferencia entre costo esperado y costo real se conserva por partida.
- La idempotencia evita duplicar stock si una solicitud se reenvía.

## Reportes

El reporte de compras permite filtrar por sucursal, proveedor, producto y periodo. Muestra recepciones, total esperado, total real y variación de costo.

## Base de datos

La migración `2026_09_inventory_purchasing` crea:

- `inv_proveedor`
- `inv_proveedor_sucursal`
- `inv_producto_proveedor`
- `inv_orden_compra`
- `inv_orden_compra_detalle`
- `inv_recepcion_compra`
- `inv_recepcion_compra_detalle`

Comandos:

```bash
npm run inventory:purchasing:check
npm run inventory:purchasing:migrate
npm run inventory:purchasing:seed-demo
```

El dato de demostración crea `Proveedor de prueba SEEP` para Alameda y Chapala. No crea órdenes, recepciones ni movimientos de inventario.

## Siguiente etapa sugerida

Agregar conteos cíclicos: programa semanal por zonas, asignación de productos, captura móvil, diferencias, evidencia y envío directo al flujo de autorización de ajustes.
