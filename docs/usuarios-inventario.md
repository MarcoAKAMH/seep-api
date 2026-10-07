# Usuarios exclusivos de inventario

Esta versión agrega roles exclusivos, asignables desde Usuarios por el administrador global:

| Rol | Alcance | Catálogo compartido |
| --- | --- | --- |
| Inventario - todas las sucursales (6) | Todas | Puede crear y editar artículos, fotos, categorías, unidades y proveedores |
| Inventario - Alameda (7) | Sucursal asociada al agente Alameda | Consulta |
| Inventario - Chapala (8) | Sucursal asociada al agente Chapala | Consulta |

Pueden operar existencias, compras, conteos y reportes de inventario en su alcance. Las autorizaciones de ajustes, reversas, cancelaciones de conteos y compras siguen reservadas al administrador global, al igual que el inventario inicial y la eliminación de artículos.

No pueden entrar al dashboard del taller, clientes, OT, técnicos, reportes generales, días festivos ni administración de usuarios. La API rechaza estas rutas con 403. Los roles de inventario no se combinan entre sí ni con otros roles. Un cambio de rol se comprueba en cada petición autenticada.

## Preparación en el ambiente de pruebas

1. Desplegar esta rama de API y app en el ambiente de pruebas.
2. Revisar `node scripts/migrate-inventory-users.js --check` contra la base de pruebas.
3. Ejecutar `node scripts/migrate-inventory-users.js --apply`. Es idempotente y cancela si los IDs ya pertenecen a otros roles. No crea cuentas ni contraseñas.
4. Como administrador global, abrir Usuarios, crear o editar la cuenta y seleccionar una sola opción de inventario. Capturar el correo y contraseña habituales.
5. Iniciar sesión con esa cuenta. Debe abrir Inventario a todo el ancho, sin panel lateral, con cuenta y cierre de sesión disponibles.

No se debe ejecutar la migración sobre producción hasta liberar esta versión. Las cuentas actuales mantienen sus roles y permisos.

Pruebas: `npm test` (incluye HTTP con metadatos simulados, sin base real); en app `npm run build` y `npm run test:inventory-ui`.
