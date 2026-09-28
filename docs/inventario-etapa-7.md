# Inventario — etapa 7: conteos cíclicos

Esta etapa agrega conteos físicos semanales independientes de clientes y órdenes de trabajo. El conteo es ciego: mientras una partida está pendiente, la API no entrega la existencia del sistema. Después de capturar la cantidad física se muestra la comparación.

## Flujo operativo

1. El administrador global o de sucursal selecciona sucursal, almacén, semana, zona y número de artículos.
2. El sistema elige primero artículos que nunca se han contado y después los menos recientes.
3. El responsable inicia el conteo y localiza cada artículo por SKU o ubicación desde el celular.
4. Captura la cantidad física, notas y una fotografía opcional.
5. Al completar, las partidas sin diferencia se cierran. Cada diferencia crea una solicitud de ajuste pendiente.
6. Solo el administrador global puede autorizar o rechazar ese ajuste con su contraseña. Hasta entonces no cambia la existencia.

Si una entrada, salida o transferencia cambia la existencia durante el conteo, el cierre se bloquea y se debe programar un conteo nuevo. Esto evita comparar contra una fotografía de stock desactualizada.

## Programación semanal

El comando de vista previa no escribe datos:

```bash
npm run inventory:counts:weekly:preview
```

El comando operativo crea un conteo para cada almacén activo que tenga existencias y omite los ya programados para la misma semana y zona:

```bash
npm run inventory:counts:weekly
```

Debe programarse cada lunes en el planificador del servidor. Usa 10 artículos y la zona `TODAS` por defecto. Se puede cambiar con `INVENTORY_WEEKLY_COUNT_SIZE` e `INVENTORY_WEEKLY_COUNT_ZONE`.

## Fotografías

Las evidencias se guardan fuera de los archivos públicos, en `uploads/inventory-counts` por defecto. Se puede configurar `INVENTORY_COUNT_EVIDENCE_DIR`. Solo acepta JPEG, PNG y WebP de hasta 2 MB; la interfaz reduce las fotografías grandes antes de enviarlas. La descarga valida la sesión y el alcance de sucursal.

No se usa QR. La captura por cámara reconoce únicamente códigos de barras lineales compatibles con el catálogo de artículos.

## Siguiente etapa sugerida

Cerrar la puesta en producción: programar el comando semanal y la sincronización diaria de alertas en el servidor, definir respaldo y retención de fotografías, agregar exportación Excel/PDF de reportes y ejecutar una prueba de aceptación con administradores de Alameda y Chapala.
