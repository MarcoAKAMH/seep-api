# Configuración de SEEP en AWS Lightsail (Ubuntu)

Estos archivos asumen que el API está en `/home/ubuntu/seep-api`, el frontend en
`/home/ubuntu/seep-app` y Nginx publica ambos bajo el mismo dominio.

## Preparar el API

```bash
cd /home/ubuntu/seep-api
cp .env.production.example .env
chmod 600 .env
nano .env
npm ci --omit=dev
```

Genera `JWT_SECRET` sin copiarlo al historial del repositorio:

```bash
openssl rand -base64 64
```

Descarga el certificado de AWS para la base administrada:

```bash
sudo install -d -m 755 /home/ubuntu/certs
sudo curl -fsSL https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
  -o /home/ubuntu/certs/global-bundle.pem
sudo chmod 644 /home/ubuntu/certs/global-bundle.pem
```

Instala las dependencias del respaldo y el servicio del API:

```bash
sudo apt update
sudo apt install -y mysql-client nginx certbot python3-certbot-nginx
sudo cp deploy/lightsail/seep-api.service.example /etc/systemd/system/seep-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now seep-api
curl -fsS http://127.0.0.1:3001/health
```

## Fotografías, alertas, conteos y respaldos

El instalador crea carpetas privadas y registra cuatro temporizadores con horario
de `America/Mexico_City`:

```bash
cd /home/ubuntu/seep-api
sudo bash deploy/lightsail/install-inventory-services.sh
```

Comprueba cada tarea sin esperar al horario:

```bash
sudo systemctl start seep-inventory-alerts.service
sudo systemctl start seep-inventory-counts.service
sudo systemctl start seep-inventory-backup.service
sudo systemctl start seep-inventory-cleanup.service
sudo journalctl -u seep-inventory-alerts.service -n 50 --no-pager
sudo journalctl -u seep-inventory-backup.service -n 50 --no-pager
sudo ls -lah /var/backups/seep/inventory
```

Los respaldos locales son útiles para recuperación rápida, pero se debe copiar
el archivo `.tar.gz` y su `.sha256` fuera de la instancia. Un snapshot de
Lightsail no sustituye el respaldo diario de la base y las fotografías.

## Red y HTTPS

En Lightsail, adjunta una IP estática. Abre públicamente solo TCP 80 y 443;
restringe TCP 22 a la IP administrativa cuando sea posible. El puerto 3001 debe
permanecer cerrado al público.

Después de instalar la configuración de Nginx del frontend:

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d seeptaller.com -d www.seeptaller.com
sudo certbot renew --dry-run
```

## Verificación después de cada despliegue

```bash
systemctl is-active seep-api nginx
curl -fsS http://127.0.0.1:3001/health
curl -fsS https://seeptaller.com/api/inventario/alcance -o /dev/null -w '%{http_code}\n'
systemctl list-timers 'seep-inventory-*' --all
journalctl -u seep-api -n 100 --no-pager
```

La petición sin sesión al alcance debe devolver `401`; esto confirma que Nginx
alcanza el API y que la ruta continúa protegida.
