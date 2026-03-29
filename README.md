  # SEEP Node API (MySQL + Express + Joi + JWT)

  API REST lista para conectar tu DB MySQL (esquema `seep_taller`) con tu app React.

  Incluye:
  - CRUD (list/get/create/update/delete) para **todas** las tablas del esquema.
  - Validación con **Joi** por tipo de dato.
  - Auth con **JWT Bearer token** (`/api/auth/login`).
  - Estructura por tabla: `src/routes/<tabla>/index.js` + `auxiliaries.js` + `validators.js`.

  ---

  ## 1) Crear la BD con tu esquema

  Importa el archivo SQL que ya tienes (ejemplo):

  ```bash
  mysql -h 127.0.0.1 -P 3306 -u root -p < seep_mysql_full_v4.sql
  ```

  > Si tu import lo haces desde Workbench, solo asegúrate que la BD se llame `seep_taller`.

  ---

  ## 2) Configurar variables de entorno

  Copia `.env.example` a `.env` y ajusta:

  ```bash
  cp .env.example .env
  ```

  Si tu MySQL **no** requiere SSL, pon:

  ```env
  DB_SSL=false
  ```

  Si tu MySQL administrado en Lightsail requiere validar la CA de AWS, descarga el bundle oficial y define:

  ```env
  DB_SSL=true
  DB_SSL_REJECT_UNAUTHORIZED=true
  DB_SSL_CA_PATH=/home/ubuntu/certs/global-bundle.pem
  ```

  ---

  ## 3) Instalar y ejecutar

  ```bash
  npm install
  npm run dev
  ```

  Salud:
  - `GET http://localhost:3001/health`

  ---

  ## 4) Login (JWT)

  ### (A) Crear usuario demo (solo desarrollo)
  ```bash
  curl -X POST http://localhost:3001/api/auth/register \
    -H "Content-Type: application/json" \
    -d '{"correo":"admin@seep.com","password":"Admin12345!","nombre":"Admin"}'
  ```

  ### (B) Login
  ```bash
  curl -X POST http://localhost:3001/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"correo":"admin@seep.com","password":"Admin12345!"}'
  ```

  Respuesta:
  ```json
  {
    "token": "JWT...",
    "user": { "id": 1, "correo": "admin@seep.com", "nombre": "Admin" }
  }
  ```

  Usa el token así:
  ```bash
  curl http://localhost:3001/api/cliente \
    -H "Authorization: Bearer JWT_AQUI"
  ```

  ---

  ## 5) Endpoints CRUD por tabla

  Todos los endpoints están protegidos con JWT (excepto `/api/auth/*` y `/health`).

  | Tabla | Base path | PK | Create (campos requeridos) |
|---|---|---|---|
| `cat_tipo_cliente` | `/api/cat_tipo_cliente` | id | nombre |
| `cat_estatus_orden` | `/api/cat_estatus_orden` | id | nombre |
| `cat_categoria_vehiculo` | `/api/cat_categoria_vehiculo` | id | nombre |
| `cat_sucursal` | `/api/cat_sucursal` | id | nombre |
| `cat_tipo_reparacion` | `/api/cat_tipo_reparacion` | id | nombre |
| `cat_calidad` | `/api/cat_calidad` | id | nombre |
| `empleado` | `/api/empleado` | id | nombre |
| `cliente` | `/api/cliente` | id | tipo_cliente_id, nombre, clave_unica |
| `vehiculo` | `/api/vehiculo` | id | cliente_id, clave_unica |
| `orden_trabajo` | `/api/orden_trabajo` | id | folio, cliente_id, estatus_id, fecha_ingreso |
| `orden_sucursal` | `/api/orden_sucursal` | id | orden_id, sucursal_id |
| `orden_asignacion` | `/api/orden_asignacion` | id | orden_id, empleado_id, rol_en_orden |
| `encuesta_satisfaccion` | `/api/encuesta_satisfaccion` | id | orden_id |
| `garantia` | `/api/garantia` | id | orden_id |
| `usuario` | `/api/usuario` | id | correo, nombre, password |
| `rol` | `/api/rol` | id | nombre |
| `permiso` | `/api/permiso` | id | clave |
| `usuario_rol` | `/api/usuario_rol` | usuario_id, rol_id | usuario_id, rol_id |
| `rol_permiso` | `/api/rol_permiso` | rol_id, permiso_id | rol_id, permiso_id |

  Patrón estándar:
  - `GET    /api/<tabla>?limit=50&offset=0`
  - `GET    /api/<tabla>/:id` *(o `/:pk1/:pk2` si PK compuesta)*
  - `POST   /api/<tabla>`
  - `PUT    /api/<tabla>/:id`
  - `DELETE /api/<tabla>/:id`

  ---

  ## 6) Demo de Create/Update/Delete (ejemplos)

  ### cat_tipo_cliente
  ```bash
  # CREATE
  curl -X POST http://localhost:3001/api/cat_tipo_cliente \
    -H "Authorization: Bearer JWT_AQUI" -H "Content-Type: application/json" \
    -d '{"nombre":"Particular"}'

  # UPDATE (id=1)
  curl -X PUT http://localhost:3001/api/cat_tipo_cliente/1 \
    -H "Authorization: Bearer JWT_AQUI" -H "Content-Type: application/json" \
    -d '{"nombre":"Empresa"}'

  # DELETE (id=1)
  curl -X DELETE http://localhost:3001/api/cat_tipo_cliente/1 \
    -H "Authorization: Bearer JWT_AQUI"
  ```

  ### cliente
  ```bash
  # CREATE
  curl -X POST http://localhost:3001/api/cliente \
    -H "Authorization: Bearer JWT_AQUI" -H "Content-Type: application/json" \
    -d '{"tipo_cliente_id":1,"nombre":"Juan Pérez","clave_unica":"JUANP-0001"}'

  # UPDATE (id=1)
  curl -X PUT http://localhost:3001/api/cliente/1 \
    -H "Authorization: Bearer JWT_AQUI" -H "Content-Type: application/json" \
    -d '{"nombre":"Juan Pérez García"}'

  # DELETE (id=1)
  curl -X DELETE http://localhost:3001/api/cliente/1 \
    -H "Authorization: Bearer JWT_AQUI"
  ```

  ### usuario_rol (PK compuesta)
  ```bash
  # CREATE
  curl -X POST http://localhost:3001/api/usuario_rol \
    -H "Authorization: Bearer JWT_AQUI" -H "Content-Type: application/json" \
    -d '{"usuario_id":1,"rol_id":1}'

  # UPDATE (reemplaza la asignación: /usuario_rol/:usuario_id/:rol_id)
  curl -X PUT http://localhost:3001/api/usuario_rol/1/1 \
    -H "Authorization: Bearer JWT_AQUI" -H "Content-Type: application/json" \
    -d '{"rol_id":2}'

  # DELETE
  curl -X DELETE http://localhost:3001/api/usuario_rol/1/2 \
    -H "Authorization: Bearer JWT_AQUI"
  ```

  ---

  ## 7) Conexión desde React (ejemplo Axios)

  ```js
  import axios from "axios";

  const api = axios.create({
    baseURL: "http://localhost:3001/api",
  });

  api.interceptors.request.use((config) => {
    const token = localStorage.getItem("token");
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  });

  // ejemplo: listar clientes
  const clientes = await api.get("/cliente?limit=50&offset=0");
  ```

  ---

## 8) Sesión segura (Access + Refresh)

Ya está implementado:
- **Access token (JWT)** corto (default 10 min) en header `Authorization: Bearer ...`
- **Refresh token opaco** en **cookie httpOnly** con **rotación** y **revocación** en BD

### Paso 1: crear tabla de refresh tokens
Ejecuta:

```bash
mysql -h 127.0.0.1 -P 3306 -u root -p seep_taller < sql/2026_03_auth_refresh_token.sql
```

### Endpoints
- `POST /api/auth/login` -> devuelve `token` + `user` y setea cookie refresh
- `POST /api/auth/refresh` -> rota refresh cookie y devuelve nuevo `token`
- `POST /api/auth/logout` -> revoca refresh actual y borra cookie

> En producción usa HTTPS y define `CORS_ORIGIN` con tu URL exacta de frontend, por ejemplo:
> `CORS_ORIGIN=https://panel.seep.com.mx`

### SSL con Lightsail Managed Database

AWS indica que los certificados etiquetados para Amazon RDS también funcionan para bases administradas en Lightsail. Si tu app falla con errores como `self-signed certificate in certificate chain`, descarga el bundle oficial y úsalo en `DB_SSL_CA_PATH`.

Ejemplo en Linux:

```bash
sudo mkdir -p /home/ubuntu/certs
curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem -o /home/ubuntu/certs/global-bundle.pem
chmod 644 /home/ubuntu/certs/global-bundle.pem
```

Luego en `.env`:

```env
DB_SSL=true
DB_SSL_REJECT_UNAUTHORIZED=true
DB_SSL_CA_PATH=/home/ubuntu/certs/global-bundle.pem
```
