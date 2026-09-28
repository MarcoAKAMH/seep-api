# Inventario SEEP - etapa 4

Esta etapa agrega controles operativos sobre el Kardex independiente:

- Transferencias entre sucursales con despacho y recepción separados. El costo de salida viaja a la sucursal destino y se incorpora a su promedio ponderado al recibir.
- Conteos físicos como solicitudes pendientes. Un administrador de sucursal puede capturarlos, pero solo el administrador global puede aprobarlos o rechazarlos después de confirmar su contraseña.
- Reversa de documentos de entrada, salida, devolución e inventario inicial. La reversa crea un documento nuevo, conserva el original y solo puede ejecutarse una vez.
- Listados con alcance por sucursal, usuario responsable, estado y folios trazables.

## Base de datos

La migración `2026_09_inventory_controls` crea:

- `inv_transferencia`
- `inv_transferencia_detalle`
- `inv_ajuste_solicitud`
- una restricción única que impide duplicar la reversa de un documento

Comandos:

```bash
npm run inventory:controls:check
npm run inventory:controls:migrate
npm run inventory:controls:seed-demo
```

El último comando es idempotente y prepara en Chapala el almacén `Almacén de prueba` con la ubicación `PRUEBA-01`, para poder recibir transferencias desde Alameda sin inventar existencias.

## Permisos

- Administrador de sucursal: despacha desde su sucursal, recibe en su sucursal y registra conteos para autorización.
- Administrador global: opera cualquier sucursal, decide ajustes pendientes y autoriza reversas confirmando contraseña.
- Agentes y otros roles: sin acceso al inventario.

## Reglas relevantes

- Una transferencia no suma existencia en destino hasta que se recibe.
- No se puede recibir una transferencia dos veces.
- Un ajuste no se aplica si la existencia cambió después del conteo; debe realizarse un conteo nuevo.
- Las salidas y reversas nunca permiten saldo negativo.
- Las operaciones sensibles conservan usuario, fecha, motivo y documento relacionado.

## Siguiente etapa sugerida

Implementar alertas automáticas y el tablero de inventario: valorización actual, productos bajo mínimo, productos sin movimiento por 90 días y notificaciones por sucursal. Después pueden agregarse compras, proveedores y órdenes de compra.
