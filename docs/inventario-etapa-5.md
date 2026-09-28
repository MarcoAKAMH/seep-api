# Inventario SEEP - etapa 5

Esta etapa agrega el tablero, las alertas automáticas y los primeros reportes operativos del inventario independiente.

## Tablero

El tablero respeta el alcance del usuario global o de sucursal y muestra:

- dinero en inventario al costo promedio actual;
- productos bajo mínimo, incluyendo el detalle de agotados;
- alertas activas y alertas pendientes de lectura del usuario;
- productos y dinero sin movimiento durante 90 días.

## Alertas

Se evalúan por producto y almacén:

- `AGOTADO`: existencia en cero con mínimo o punto de reorden configurado;
- `BAJO_MINIMO`: existencia mayor a cero y menor o igual al mínimo;
- `PUNTO_REORDEN`: existencia mayor al mínimo y menor o igual al punto de reorden;
- `SOBRE_MAXIMO`: existencia superior al máximo;
- `SIN_MOVIMIENTO`: existencia positiva sin movimientos durante 90 días.

Cada condición genera una sola alerta activa. Cuando deja de cumplirse, la alerta se marca resuelta y permanece en el historial. La lectura se registra por usuario.

La evaluación se ejecuta automáticamente después de movimientos y cambios de límites, y al consultar el tablero. Para una revisión diaria independiente de que alguien abra la aplicación puede programarse:

```bash
npm run inventory:alerts:sync
```

## Reportes

- Límites: existencia, mínimo, punto de reorden, máximo, estado y valor por almacén.
- Rotación de 90 días: cantidad utilizada, número de salidas, costo consumido y última salida. Permite ordenar de mayor a menor o identificar artículos sin uso.
- Alertas: filtro por tipo y acciones para marcar una o todas como leídas.

## Migración

```bash
npm run inventory:alerts:check
npm run inventory:alerts:migrate
npm run inventory:alerts:sync
```

La migración `2026_09_inventory_alerts` incorpora `PUNTO_REORDEN` al historial de notificaciones.

## Resultado inicial con los datos importados

- Valor de inventario: `$814,233.876 MXN`.
- 50 alertas de bajo mínimo.
- 10 alertas de agotado.
- 73 alertas de sobre máximo.
- 0 productos con más de 90 días sin movimiento, porque el inventario inicial se registró recientemente.

## Siguiente etapa sugerida

Agregar proveedores y compras: catálogo de proveedores, órdenes de compra, recepción parcial o total, variación de costo y propuestas de compra originadas por alertas de reorden.
