# Inventario independiente — etapa 1

## Alcance entregado

Base de datos y autorización para gestión manual interna. No hay relaciones con
clientes, vehículos, órdenes de trabajo, facturación ni cobros. No incluye todavía
pantallas, CRUD de artículos, movimientos operativos ni generación de alertas.
Los productos son físicos: materia prima, producto terminado o consumible.

La migración crea 14 tablas de dominio y `inv_migracion` como registro de versión:

| Tablas | Función |
| --- | --- |
| inv_categoria, inv_unidad, inv_producto | Catálogo global, SKU y código únicos; precios y foto opcional |
| inv_almacen, inv_ubicacion | Ubicaciones por sucursal; código buscable |
| inv_producto_almacen | Mínimo, máximo y reorden por almacén |
| inv_costo_sucursal | Último costo y promedio por producto/sucursal |
| inv_existencia | Saldo por producto/ubicación, con seis decimales |
| inv_documento, inv_documento_detalle | Motivo, referencia, cantidades, costos, autorización e idempotencia |
| inv_movimiento | Base del kardex, costo histórico, saldo y vínculo a reversa |
| inv_notificacion, inv_notificacion_lectura | Historial de alertas y lectura individual |
| inv_auditoria | Autor, acción, entidad y valores anteriores/posteriores |

Las claves foráneas compuestas impiden mezclar almacén, ubicación y sucursal en
una existencia o partida. No hay borrados en cascada. Las restricciones CHECK
rechazan cantidades negativas de existencia, costos negativos y límites inválidos.
La configuración inicial de límites es cero; la etapa de alertas definirá cuándo
se habilita cada regla. Una alerta activa por producto/almacén/tipo puede coexistir
con múltiples alertas resueltas históricas.

## Permisos

Se reutilizan las asignaciones existentes de roles; no se crean ni cambian cuentas.
El perfil se recarga desde la BD en cada petición y se entrega en login/refresh.

| Capacidad | Global | Administrador de sucursal | Agente |
| --- | --- | --- | --- |
| can_manage_inventory | Todas las sucursales | Una sucursal asignada válida | No |
| can_manage_inventory_catalog | Sí | No | No |
| can_authorize_inventory_adjustments | Sí | No | No |

`GET /api/inventario/acceso` requiere JWT y acceso al inventario. Devuelve alcance
y capacidades. El global obtiene `sucursal_ids: null` (todas); el administrador
local recibe una lista con su sucursal. `?sucursal_id=N` valida existencia y alcance.
No se hereda el permiso `can_view_all_orders`: agentes con ambas sucursales siguen
sin acceso. Roles ambiguos o administradores sin asignación válida quedan denegados.

`RequireInventory` queda preparado para las futuras rutas React. Todavía no está
montado en una pantalla ni aparece una opción nueva en el menú.

## Migración

Desde seep-api:

```powershell
npm run inventory:check
npm run inventory:migrate
```

Carga `.env` y después `.env.local`, igual que los scripts existentes. Requiere
MySQL 8.0.16 o posterior, tablas padre InnoDB e identificadores BIGINT UNSIGNED.
`--check` solo consulta metadatos. La aplicación usa un bloqueo de migración por
base, crea tablas vacías y registra checksum; repetirla no duplica objetos.
No se insertan productos, saldos, almacenes ni documentos de ejemplo.

El DDL de MySQL hace commits implícitos: una falla intermedia puede dejar tablas
creadas. En ese caso el script se detiene al reintentar y exige revisar la aplicación
parcial; no borra ni recrea automáticamente tablas. No hay rollback destructivo.
Una migración ya aplicada no se edita: cambios posteriores requieren otra versión.
El chequeo comprueba checksum y presencia de tablas, no reemplaza una auditoría de
alteraciones manuales del esquema.

## Verificación

```powershell
npm test
$env:SEEP_MYSQL_TESTS = '1'
node --test test/mysql-inventory.test.js
```

La integración crea una base temporal `seep_test_inventory_<fecha>_<pid>`, copia
solo estructuras padre, usa datos ficticios y elimina únicamente esa base al terminar.
Requiere permisos CREATE/DROP DATABASE. Comprueba migración, repetición, checksum,
restricciones, decimales, alertas y autenticación HTTP real, incluyendo revocación
de permisos en la siguiente petición. No copia registros del taller.

## Etapas siguientes

2. Catálogo: pantallas de artículos, unidades, categorías, almacenes y ubicaciones;
   validación en API, filtros, búsqueda, escaneo, fotos y baja lógica. Catálogo global;
   parámetros y consulta de existencias por sucursal.
3. Carga inicial y movimientos manuales: motor transaccional, promedio ponderado,
   bloqueo de saldos, idempotencia, kardex y reversas. Toda escritura de existencias
   debe pasar por este motor; no exponer CRUD directo para saldos o movimientos.
4. Transferencias: despacho, tránsito, recepción y discrepancias, con validación
   específica de origen y destino. Los tipos de documento ya están reservados;
   el flujo y sus tablas específicas se agregarán en una migración posterior.
5. Alertas y dashboard: motor de evaluación, notificaciones persistentes y cuatro
   indicadores (valor, bajo mínimo, agotados, valor sin movimiento de 90 días).
6. Conteos y ajustes: solicitudes, evidencia y autorización global con reautenticación.
7. Reportes: valoración, límites, rotación, entradas/salidas, mermas y auditoría.
8. Piloto y operación: conteo real de apertura, capacitación y conciliación.

Las tablas de historial no son aún un motor inmutable: el servicio de movimientos
de la etapa 3 impondrá append-only, reversas y escritura conjunta de saldo/documento.
Asimismo, autorización global de ajustes, filtrado de destinatarios y auditoría de
cambios se deben aplicar en cada endpoint futuro; la existencia de una FK no otorga
autorización. No habilitar movimientos hasta contar con esas garantías.
