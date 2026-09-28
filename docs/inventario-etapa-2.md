# Etapa 2 — catálogo y organización

## Entrega

Ruta React `/inventory`, visible en el menú solo para administradores de inventario.
Cinco secciones: artículos, categorías, unidades, almacenes y ubicaciones. Incluye
creación/edición, baja lógica donde existe `activo`, búsqueda, filtros y paginación.
Las unidades no se eliminan ni se desactivan en esta etapa: clave y precisión se
bloquean cuando ya están en uso, para conservar la interpretación de cantidades.

El catálogo de productos, categorías y unidades es global. Los administradores de
sucursal pueden consultarlo y configurar límites en sus propios almacenes; solo el
global modifica el catálogo compartido. No se infiere acceso al inventario a partir
de permisos de órdenes. Almacenes, ubicaciones y límites se filtran y autorizan en
la API antes de guardar o paginar.

## API (JWT + permiso de inventario)

| Ruta bajo `/api/inventario` | Métodos | Propósito |
| --- | --- | --- |
| `/catalogos` | GET | Referencias para formularios, filtradas por sucursal |
| `/productos` | GET, POST | Buscar/listar y crear artículos |
| `/productos/:id` | PUT | Editar o desactivar un artículo |
| `/categorias`, `/unidades`, `/almacenes`, `/ubicaciones` | GET, POST | Listar y crear |
| Las rutas anteriores + `/:id` | PUT | Editar el registro completo |
| `/productos/:id/limites` | GET, PUT | Consultar y guardar límites por almacén |
| `/fotos` | POST | Subir imagen binaria JPEG, PNG o WebP (hasta 2 MB) |
| `/fotos/:filename` | GET | Leer foto autenticada, sin caché pública |

Listas: `q`, `limit` (1 a 100), `offset`, `activo`, `sucursal_id`; productos aceptan
`categoria_id` y `tipo`. Respuesta `{ items, total, limit, offset }`. El catálogo
compartido sigue siendo visible en cualquier selección de sucursal; no contiene
saldos ni costos de otras sucursales. Los precios públicos/mayoreo son globales.

Los PUT reciben campos completos según el formulario. Importes y límites viajan
como cadenas decimales (hasta 12 enteros y 6 decimales); no enviar floats para ellos.
Se rechazan campos desconocidos, precios negativos, referencias inválidas, cambios
de sucursal/almacén de registros existentes y códigos duplicados. No hay DELETE.
Las escrituras y su auditoría se confirman juntas en una transacción. Desactivar
artículos, almacenes o ubicaciones con existencias positivas devuelve 409.
Cambiar la unidad de un producto configurado en un almacén también devuelve 409.

## Fotos y escáner

El formulario acepta enlace HTTPS o carga de archivo. La carga del navegador
redimensiona a un máximo de 1280 píxeles y codifica JPEG antes de enviar. La API
valida tipo y firma, asigna un UUID y guarda fuera de los archivos públicos. Fotos
y catálogo comparten el acceso de administradores; agentes no pueden leerlas.

Directorio predeterminado: `seep-api/uploads/inventory`. Puede configurarse con
`INVENTORY_PHOTO_DIR` como ruta absoluta. En despliegue debe ser persistente,
escribible por la API y respaldarse junto con MySQL. No se agregan fotos a Git.
Fotos cargadas antes de cancelar un formulario se conservan: una limpieza futura
debe comprobar referencias actuales e históricas antes de eliminarlas.

La cámara utiliza `@zxing/browser`, cargado bajo demanda. Soporta exclusivamente códigos de barras lineales,
selección de cámara, cierre/liberación de pistas y captura manual
como alternativa. Se usa para buscar o rellenar el código; no crea movimientos ni
cantidades. La cámara requiere HTTPS (o localhost) y permiso del navegador.
Referencia de implementación: https://github.com/zxing-js/browser

## Validación

Backend:

```powershell
$env:SEEP_MYSQL_TESTS = '1'
npm test
```

La integración de inventario comprueba altas/ediciones, permisos, alcance, filtros,
paginación, auditoría, decimales exactos, límites sin alterar saldos y fotos privadas.
Usa una base y un directorio de imágenes temporales, que elimina al terminar.

Frontend, desde seep-app:

```powershell
npm run build
npm run test:inventory-ui
```

El smoke test inicia Vite en 127.0.0.1:5175 y usa respuestas API ficticias; nunca
escribe en la BD del taller. En Windows usa Edge instalado; en otros sistemas
requiere instalar Chromium de Playwright (`npx playwright install chromium`).
Prueba formularios, consulta restringida, límites, filtros, diseño móvil y rechazo
del permiso de cámara. La lectura con una cámara física Android/iPhone requiere
verificación en esos dispositivos; no queda demostrada por el smoke test.

## Puesta en marcha y siguiente etapa

Esta etapa reutiliza el esquema de etapa 1 y no necesita otra migración. Desplegar
API y frontend juntos y reiniciar la API. Actualizar la sesión si todavía no tiene
las capacidades de inventario. Comenzar por categorías y unidades; después crear
artículos, almacenes/ubicaciones y límites. No se insertan catálogos ni saldos ficticios.

La etapa 3 implementará carga inicial y entradas/salidas manuales mediante documentos,
costo promedio, kardex, idempotencia y reversas. En esta etapa no hay operaciones de
stock, alertas automáticas, órdenes de compra ni relación con clientes u OT.
