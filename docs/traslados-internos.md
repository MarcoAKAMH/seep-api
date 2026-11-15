# Traslados internos

Desde Existencias, «Mover ubicación» abre un formulario para el artículo y la
ubicación elegidos. Permite mover una cantidad positiva a otra ubicación activa
de la misma sucursal, dentro del mismo almacén o entre almacenes de esa sucursal.
Los usuarios de consulta conservan acceso de solo lectura.

`POST /api/inventario/traslados-internos` recibe `sucursal_id`, `producto_id`,
`ubicacion_origen_id`, `ubicacion_destino_id`, `cantidad` (decimal en texto),
`motivo` e `idempotencia`. La API obtiene los almacenes de las ubicaciones.

La operación bloquea la sucursal, comprueba disponibilidad y registra dos
documentos dentro de una transacción: `TRANSFERENCIA_SALIDA` y
`TRANSFERENCIA_ENTRADA`. La entrada apunta a la salida mediante
`documento_origen_id`; ambos comparten una referencia `TI-…`. No requiere cambios
de esquema. Los traslados entre sucursales conservan su despacho y recepción.

El costo promedio, el último costo y la cantidad total de la sucursal se conservan.
Las alertas se evalúan sobre los saldos finales. Un fallo revierte ambas partes.
Los traslados internos no incrementan las salidas del reporte de rotación.
Los reintentos con el mismo identificador y contenido devuelven el resultado
original; cambiar el contenido de una solicitud aplicada devuelve 409.

El resultado incluye el folio, los dos IDs de documento y los saldos finales.
Kardex expone `traslado_folio` en ambos movimientos, admite buscarlo con `q` y
conserva las ubicaciones, el usuario y el motivo. Para corregir un traslado,
registrar otro traslado en sentido contrario con el motivo correspondiente.

Verificación: `test/mysql-relocation.test.js` crea y elimina una base temporal con
datos sintéticos. CI lo ejecuta en un servicio MySQL aislado antes del despliegue.
