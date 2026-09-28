# Inventario — etapa 8: operación local y puesta en producción

Esta etapa deja preparado el inventario para validación local. No publica código, no registra tareas de Windows y no envía notificaciones fuera de SEEP.

## Exportaciones

Existencias, Kardex, alertas, límites, rotación, compras y conteos permiten descargar CSV, Excel y PDF. La interfaz recorre todas las páginas del reporte respetando sucursal y filtros. Existe un límite preventivo de 50,000 filas por archivo.

## Calidad de datos

`npm run inventory:quality` genera un diagnóstico de artículos sin fotografía o nombre técnico, y cobertura por sucursal de existencias, límites, proveedores preferidos y ubicaciones. Es de solo lectura; los datos faltantes se deben capturar con información real.

## Respaldo

`npm run inventory:backup` crea un ZIP en `backups/inventory` con:

- exportación SQL completa mediante `mysqldump`;
- fotografías de artículos;
- evidencias de conteos;
- manifiesto SHA-256 para verificar integridad.

Conserva 30 días por defecto. Para validar un archivo:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-inventory-backup.ps1 -Archive backups/inventory/seep-inventory-AAAAmmdd-HHMMSS.zip
```

La verificación expande en una carpeta temporal, comprueba tamaño y hash de cada archivo y confirma que el SQL contiene estructura restaurable. No restaura ni modifica la base activa.

Para ensayar una restauración se exige una base temporal cuyo nombre incluya `restore_test`. La base configurada está bloqueada:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/restore-inventory-backup.ps1 -Archive <archivo.zip> -TargetDatabase seep_inventory_restore_test -Apply -DropAfterVerify
```

El comando crea la base temporal, importa el respaldo, consulta productos, existencias y migraciones, y la elimina al terminar.

## Retención de fotografías

`npm run inventory:media:preview` informa qué se eliminaría. `npm run inventory:media:cleanup` aplica la política:

- fotografías de productos referenciadas: se conservan;
- archivos huérfanos: 30 días por defecto;
- evidencias de conteos completados o cancelados: 365 días por defecto.

Los periodos se configuran con `INVENTORY_ORPHAN_MEDIA_DAYS` e `INVENTORY_EVIDENCE_RETENTION_DAYS`.

## Tareas de Windows

`npm run inventory:tasks:preview` muestra cuatro tareas sin registrarlas: respaldo diario, alertas diarias, conteos cada lunes y limpieza semanal. Cuando el servidor y horarios estén aprobados, un administrador puede ejecutar:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/register-inventory-tasks.ps1 -Apply
```

Los ejecutores están en `ops/tasks` y escriben sus resultados en `logs`.

La tarea diaria de alertas también crea borradores de orden de compra para productos bajo punto de reorden que tengan máximo y proveedor preferido. Omite cualquier producto con una orden abierta. El borrador nunca se autoriza ni se envía automáticamente. `npm run inventory:reorder:preview` permite revisar el resultado sin escribir datos.

## Aceptación local

`npm run inventory:acceptance` revisa todas las migraciones, calidad, retención en vista previa, programación semanal en vista previa, pruebas MySQL/API, compilación y navegador para administrador global y administrador de sucursal.

La prueba usa una base temporal para las operaciones destructivas. La base configurada solo se consulta en diagnósticos y vistas previas.

## Antes de producción

1. Completar los datos reales señalados por el diagnóstico, especialmente Chapala.
2. Definir rutas privadas y políticas de respaldo en `.env.local` tomando `.env.inventory.example` como guía.
3. Ejecutar y verificar un respaldo.
4. Ejecutar la aceptación local.
5. Registrar las tareas únicamente en el servidor definitivo.
6. Mantener HTTPS y `CORS_ORIGIN` restringido al dominio real.
