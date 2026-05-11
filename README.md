# SebasPresent

MMO sandbox estilo RuneScape. Cliente web (Three.js) + servidor en Cloudflare Workers + D1 (SQL).

**Slice 1 actual**: login OSRS-style con registro, autenticación y sesión persistente.

## Arquitectura

```
sebaspresent/
├── client/          → Cloudflare Pages (frontend estático)
│   ├── index.html   → entry HTML
│   ├── style.css    → look OSRS (parchment + serif)
│   ├── assets/      → música, futuros sprites
│   └── src/         → módulos JS (auth, api, ui)
└── server/          → Cloudflare Worker (deploy con wrangler)
    ├── worker.js    → endpoints /api/register, /api/login, /api/me, /api/logout
    └── schema.sql   → tabla users + sessions
```

El cliente es **HTML + ES modules nativos, sin build step**. Editas un archivo, recargas, listo.
El servidor sí requiere `wrangler` (Node.js) para deployar a Cloudflare.

## Setup local (primera vez)

### 1. Requisitos
- Node.js 18+ → https://nodejs.org
- Cuenta gratis de Cloudflare → https://cloudflare.com
- Git

### 2. Instalar dependencias
```bash
npm install
```

Esto instala solo `wrangler` (la CLI de Cloudflare). El cliente no necesita nada.

### 3. Login en Cloudflare
```bash
npx wrangler login
```

Abre el navegador y autoriza.

### 4. Crear la base de datos D1
```bash
npx wrangler d1 create sebaspresent-db
```

Te imprime algo como:
```
[[d1_databases]]
binding = "DB"
database_name = "sebaspresent-db"
database_id = "abc123-..."
```

**Copia el `database_id`** y pégalo en `wrangler.toml` reemplazando `PASTE_DATABASE_ID_HERE`.

### 5. Aplicar el schema
```bash
# Local (para desarrollo)
npx wrangler d1 execute sebaspresent-db --local --file=server/schema.sql

# Producción (cuando vayas a deployar)
npx wrangler d1 execute sebaspresent-db --remote --file=server/schema.sql
```

### 6. Configurar el secret del JWT
```bash
# Genera un secret aleatorio largo
openssl rand -hex 32

# Súbelo a Cloudflare
npx wrangler secret put JWT_SECRET
# Pega el secret cuando lo pida
```

Para desarrollo local crea un archivo `.dev.vars` (NO commitear) con:
```
JWT_SECRET=el_mismo_secret_que_generaste
```

### 7. Probar local
```bash
# Terminal 1 — corre el Worker en local
npx wrangler dev

# Terminal 2 — sirve el cliente
cd client
python3 -m http.server 8080
# o si no tienes python: npx serve .
```

Abre http://localhost:8080 — debería salir la pantalla de login de SebasPresent.

## Deploy a producción

### Worker (backend)
```bash
npx wrangler deploy
```

Te da una URL como `https://sebaspresent-api.tu-cuenta.workers.dev`. **Cópiala** y pégala en `client/src/api.js` (constante `API_URL`).

### Cliente (Cloudflare Pages)
1. Sube este repo a GitHub
2. En el dashboard de Cloudflare → Workers & Pages → Create application → Pages → Connect to Git
3. Selecciona el repo
4. Configuración del build:
   - **Framework preset**: None
   - **Build command**: (vacío)
   - **Build output directory**: `client`
5. Save and Deploy

En 1-2 min tienes el juego en `https://sebaspresent.pages.dev`.

## Notas

- **Música de login**: actualmente uso `Blind_Pick_-_Old_Champion_Select_Music.mp3` (música de League of Legends, copyright Riot Games). Está bien para desarrollo personal, pero **antes de hacer público el juego cámbiala por música original o royalty-free** (Pixabay, Incompetech, freemusicarchive).
- **Las contraseñas se hashean con PBKDF2** (600.000 iteraciones, SHA-256). No se guardan en texto plano nunca.
- **Las sesiones se guardan en D1** como tokens aleatorios, no en JWT — más fácil de revocar y simpler.

## Lo que falta (siguientes slices)

- Slice 2: mundo 3D con terreno vertex-colored y movimiento click-to-move
- Slice 3: cargar `character_2.fbx`, sistema de equipamiento por submeshes
- Slice 4: banco GP + NPC banker + items iniciales
- ...

Ver `HANDOFF.md` para el plan completo de 10 slices.

## Créditos y assets de terceros

El código fuente original de este repositorio (HTML, CSS, JavaScript de cliente,
Worker JavaScript, schema SQL y configuración) está licenciado bajo
[MIT](LICENSE).

Algunos assets bundleados aquí son de sus respectivos propietarios y NO
están cubiertos por la licencia MIT del código:

- **`client/assets/music/login_theme.mp3`** — "Blind Pick / Old Champion Select",
  composición original de **Riot Games** (League of Legends, 2012). Todos los
  derechos pertenecen a Riot Games. Se usa aquí de forma no comercial.
- **Modelos de personaje y animaciones FBX** (cuando se añadan en Slice 3) —
  generados con **Mixamo** (Adobe). Todos los derechos pertenecen a Adobe.
  Se usan conforme a los términos de servicio gratuitos de Mixamo.
- **Fuentes Cinzel e IM Fell English** — Google Fonts, licencia Open Font License.

Si eres titular de derechos de alguno de estos assets y quieres que se retiren,
abre un issue en este repositorio y procederé con la retirada.
