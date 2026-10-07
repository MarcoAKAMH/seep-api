# Usuarios exclusivos de inventario

Esta versión agrega roles exclusivos, asignables desde Usuarios por el administrador global:

| Rol | Alcance | Catálogo compartido |
| --- | --- | --- |
| Inventario - todas las sucursales (6) | Todas | Solo consulta de artículos y precios |
| Inventario - Alameda (7) | Sucursal asociada al agente Alameda | Solo consulta de artículos y precios |
| Inventario - Chapala (8) | Sucursal asociada al agente Chapala | Solo consulta de artículos y precios |

Los tres roles ven exclusivamente el catálogo: fotografías, SKU, nombres, categoría, unidad, tipo, estado, precio público y precio de mayoreo. Pueden buscar, filtrar y cambiar de página. No pueden crear, editar, eliminar, ajustar límites, cargar fotos ni acceder a existencias, movimientos, compras, proveedores, conteos, alertas, costos o reportes. La API solo permite GET de acceso, metadatos de catálogo, productos y fotografías. Los metadatos no incluyen almacenes ni ubicaciones y los productos se entregan con una lista explícita de campos de consulta.

No pueden entrar al dashboard del taller, clientes, OT, técnicos, reportes generales, días festivos ni administración de usuarios. La API rechaza estas rutas con 403. Los roles de inventario no se combinan entre sí ni con otros roles. Un cambio de rol se comprueba en cada petición autenticada.

## Preparación en el ambiente de pruebas

1. Desplegar esta rama de API y app en el ambiente de pruebas.
2. Revisar `node scripts/migrate-inventory-users.js --check` contra la base de pruebas.
3. Ejecutar `node scripts/migrate-inventory-users.js --apply`. Es idempotente y cancela si los IDs ya pertenecen a otros roles. No crea cuentas ni contraseñas.
4. Como administrador global, abrir Usuarios, crear o editar la cuenta y seleccionar una sola opción de inventario. Capturar el correo y contraseña habituales.
5. Iniciar sesión con esa cuenta. Debe abrir directamente el catálogo de consulta a todo el ancho, sin panel lateral, con cuenta y cierre de sesión disponibles.

No se debe ejecutar la migración sobre producción hasta liberar esta versión. Las cuentas actuales mantienen sus roles y permisos.

Pruebas: `npm test` (incluye HTTP con metadatos simulados, sin base real); en app `npm run build` y `npm run test:inventory-ui`.
