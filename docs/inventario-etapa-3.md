# Etapa 3 — existencias, movimientos y carga Excel

## Entrega operativa

La pantalla de Inventario ahora contiene tres funciones adicionales:

- Existencias: artículo, almacén, ubicación, cantidad, costo promedio y valor.
- Registrar movimiento: inventario inicial, entrada, salida o devolución.
- Kardex: fecha, folio, artículo, tipo, cantidad, saldo, ubicación y usuario.

El administrador global puede registrar inventario inicial. Los administradores de
sucursal pueden registrar entradas, salidas y devoluciones solo en su sucursal.
Todos pueden consultar únicamente el alcance que ya tenían asignado.

Cada documento recibe un folio, motivo, referencia e identificador de idempotencia.
Si el navegador repite la misma solicitud, el motor devuelve el documento existente
sin volver a modificar el saldo. Las partidas se aplican en una transacción, bloquean
los saldos implicados y rechazan existencias negativas.

Las entradas y devoluciones recalculan el costo promedio ponderado móvil de todo el
producto en la sucursal. Las salidas conservan el promedio vigente como costo histórico.
Se utilizan decimales con seis posiciones; no se usan floats para el cálculo interno.
Los movimientos aplicados no se editan ni eliminan directamente. La interfaz aún no
incluye reversas ni ajustes autorizados; corresponden a la siguiente etapa de control.

## API

| Ruta bajo `/api/inventario` | Método | Función |
| --- | --- | --- |
| `/existencias` | GET | Saldos por ubicación, costo y valor |
| `/kardex` | GET | Historial trazable de movimientos |
| `/movimientos` | POST | Aplica documento y partidas en una transacción |

Las consultas aceptan `sucursal_id`, `q`, `producto_id`, `limit` y `offset`; kardex
también acepta `tipo`. El movimiento acepta de 1 a 200 partidas. Para entradas,
devoluciones e inventario inicial se requiere costo; en salidas el servidor asigna
el promedio actual.

## Importación de prueba aplicada

Fuente: `C:\Users\Admin\Downloads\INVENTARIO ALMACEN SEEP (Reparado).xlsx`

- SHA-256: `24b147b3d7f4ac0bf928c7e32de16a3ea2594bb7607deeba6a0076957df63e9b`
- Sucursal: Alameda (`cat_sucursal.id = 1`).
- Usuario de carga: Administrador Global (`usuario.id = 1`).
- Almacén: `Almacén de prueba Excel`.
- Ubicación: `XLS-SIN-UBICAR`.
- Unidad provisional: `PZA — Pieza / presentación`.
- Catálogo creado: 730 artículos.
- Saldos iniciales aplicados: 681 artículos, 3,205 unidades/presentaciones.
- Valor inicial según costos presentes en el Excel: $814,233.876 MXN.
- Documentos iniciales: 4; partidas/kardex: 681.
- Pendientes de revisión: 10.

El proveedor original, archivo, hash y filas de origen se conservaron en
`inv_auditoria`. Los proveedores todavía no son un catálogo operativo; eso pertenece
a la etapa de compras. Los nombres técnico y comercial se tomaron del mismo texto del
Excel, y seis categorías se asignaron por palabras del nombre. Deben revisarse antes
de considerar el catálogo definitivo.

La importación omitió filas sin un nombre utilizable. Para códigos ausentes generó
`XLS-ALM-FILA-<fila>`. Los siguientes códigos repetidos se crearon una sola vez sin
saldo inicial para evitar sumar o escoger cantidades ambiguas:

- `35852 AU` — filas 132 y 1093.
- `35735 M` — filas 296 y 1014.
- `NHX2424A` — filas 423 y 546.
- `FC50712N` — filas 461 y 1064.
- `31523` — filas 505 y 888.
- `NHE90300` — filas 528 y 1001.
- `AN-10` — filas 532 y 1052.
- `FR-903` — filas 846 y 927.
- `37907 AU` — filas 947 y 1059.

El SKU `37924`, fila 355, indica cantidad 2 pero no costo; se creó el artículo sin
saldo inicial. Estos diez casos están guardados dentro del evento `inv_importacion`
para resolverlos después de un conteo físico.

El importador es `scripts/import-inventory-workbook.js` y primero debe ejecutarse sin
`--apply` para obtener la vista previa. El hash impide importar dos veces el mismo
archivo. La aplicación completa es transaccional. El lector de Excel está en
`scripts/read-inventory-workbook.ps1` y no requiere Microsoft Excel instalado.

## Validación

```powershell
$env:SEEP_MYSQL_TESTS = '1'
npm test
```

Las pruebas verifican promedio ponderado exacto, idempotencia, salida con costo
histórico, rollback por stock insuficiente, aislamiento de sucursales, existencias y
kardex. En el frontend:

```powershell
npm run build
npm run test:inventory-ui
```

El smoke test cubre captura de movimientos para administrador global y de sucursal,
además del catálogo, límites, móvil y cámara. Usa respuestas ficticias.

## Siguiente paso recomendado

Realizar un conteo físico de `XLS-SIN-UBICAR`, asignar ubicaciones reales y resolver
los diez pendientes. Después implementar transferencias, reversas y ajustes con
autorización global, antes de activar alertas automáticas y dashboard.
