<?php
declare(strict_types=1);

require_once __DIR__ . '/lib/site-model.php';
require_once __DIR__ . '/lib/render.php';

$configFile = __DIR__ . '/config.php';
if (!is_file($configFile)) {
    http_response_code(503);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'Nimble is not configured. Copy config.example.php to config.php and add the MySQL connection details.';
    exit;
}
$config = require $configFile;
if (!is_array($config)) throw new RuntimeException('The PHP configuration must return an array.');
$config['production'] = $config['production'] ?? true;
$config['public_url'] = rtrim((string)($config['public_url'] ?? ''), '/');
$config['storage_dir'] = rtrim((string)($config['storage_dir'] ?? (__DIR__ . '/storage')), '/\\');
$config['session_days'] = (int)($config['session_days'] ?? 7);
$config['max_document_bytes'] = (int)($config['max_document_bytes'] ?? 2000000);
$config['max_media_bytes'] = (int)($config['max_media_bytes'] ?? 15728640);
$config['media_quota_bytes'] = (int)($config['media_quota_bytes'] ?? 1073741824);
if ($config['public_url'] === '' || !str_starts_with($config['public_url'], 'https://')) throw new RuntimeException('Production requires public_url=https://your-domain.');
if ($config['session_days'] < 1 || $config['session_days'] > 30) throw new RuntimeException('session_days must be between 1 and 30.');

$storage = $config['storage_dir'];
$dataDir = $storage . '/data';
$uploadsDir = $storage . '/uploads';
foreach ([$storage, $dataDir, $uploadsDir] as $directory) {
    if (!is_dir($directory) && !mkdir($directory, 0750, true) && !is_dir($directory)) throw new RuntimeException('Could not create writable storage directory.');
}
$dbConfig = $config['db'] ?? [];
$dsn = 'mysql:host=' . ($dbConfig['host'] ?? 'localhost') . ';dbname=' . ($dbConfig['name'] ?? '') . ';charset=utf8mb4';
$pdo = new PDO($dsn, (string)($dbConfig['user'] ?? ''), (string)($dbConfig['password'] ?? ''), [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC, PDO::ATTR_EMULATE_PREPARES => false]);
$pdo->exec("SET time_zone = '+00:00'");

function db(): PDO { global $pdo; return $pdo; }
function cfg(string $key, mixed $fallback = null): mixed { global $config; return $config[$key] ?? $fallback; }
function timestamp(): string { return gmdate('Y-m-d H:i:s'); }
function db_transaction(callable $operation): mixed
{
    $pdo = db(); $pdo->beginTransaction();
    try { $result = $operation(); $pdo->commit(); return $result; }
    catch (Throwable $error) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $error; }
}
function setup_database(): void
{
    $tables = [
        "CREATE TABLE IF NOT EXISTS users (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,name VARCHAR(120) NOT NULL,email VARCHAR(254) NOT NULL UNIQUE,password_hash VARCHAR(255) NOT NULL,role VARCHAR(20) NOT NULL DEFAULT 'user',created_at DATETIME NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS sessions (token_hash CHAR(64) NOT NULL PRIMARY KEY,user_id BIGINT UNSIGNED NOT NULL,csrf_token CHAR(48) NOT NULL,expires_at BIGINT NOT NULL,created_at DATETIME NOT NULL,INDEX sessions_user (user_id),INDEX sessions_expiry (expires_at),CONSTRAINT sessions_user_fk FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS sites (id VARCHAR(40) NOT NULL PRIMARY KEY,owner_id BIGINT UNSIGNED NOT NULL,document_json LONGTEXT NOT NULL,published_json LONGTEXT NULL,revision INT UNSIGNED NOT NULL DEFAULT 1,published_revision INT UNSIGNED NULL,updated_at DATETIME NOT NULL,published_at DATETIME NULL,CONSTRAINT sites_owner_fk FOREIGN KEY(owner_id) REFERENCES users(id)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS site_members (site_id VARCHAR(40) NOT NULL,user_id BIGINT UNSIGNED NOT NULL,role VARCHAR(20) NOT NULL,created_at DATETIME NOT NULL,PRIMARY KEY(site_id,user_id),CONSTRAINT members_site_fk FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE,CONSTRAINT members_user_fk FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS templates (id CHAR(32) NOT NULL PRIMARY KEY,site_id VARCHAR(40) NOT NULL,name VARCHAR(120) NOT NULL,description VARCHAR(500) NOT NULL DEFAULT '',document_json LONGTEXT NOT NULL,created_at DATETIME NOT NULL,updated_at DATETIME NOT NULL,UNIQUE KEY templates_site_name (site_id,name),INDEX templates_updated (site_id,updated_at),CONSTRAINT templates_site_fk FOREIGN KEY(site_id) REFERENCES sites(id) ON DELETE CASCADE) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS messages (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,name VARCHAR(120) NOT NULL,email VARCHAR(254) NOT NULL,message TEXT NOT NULL,page_id VARCHAR(120) NOT NULL,created_at DATETIME NOT NULL,INDEX messages_created (created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS app_settings (`key` VARCHAR(80) NOT NULL PRIMARY KEY,value TEXT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS rate_limits (`key_name` VARCHAR(190) NOT NULL PRIMARY KEY,count_value INT UNSIGNED NOT NULL,window_until BIGINT NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS audit_events (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,user_id BIGINT UNSIGNED NULL,action VARCHAR(80) NOT NULL,metadata_json TEXT NULL,created_at DATETIME NOT NULL,INDEX audit_created (created_at)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
    ];
    foreach ($tables as $table) db()->exec($table);
    db()->prepare("INSERT IGNORE INTO app_settings (`key`,value) VALUES ('contact_secret',?)")->execute([bin2hex(random_bytes(32))]);
}
setup_database();

function app_setting(string $key): ?string { $stmt = db()->prepare('SELECT value FROM app_settings WHERE `key`=?'); $stmt->execute([$key]); $value = $stmt->fetchColumn(); return $value === false ? null : (string)$value; }
function audit(?int $userId, string $action, array $metadata = []): void { $stmt = db()->prepare('INSERT INTO audit_events(user_id,action,metadata_json,created_at) VALUES(?,?,?,?)'); $stmt->execute([$userId, $action, json_encode($metadata, JSON_UNESCAPED_UNICODE), timestamp()]); }
function user_public(int $id): ?array { $stmt = db()->prepare('SELECT id,name,email,role,created_at FROM users WHERE id=?'); $stmt->execute([$id]); $row = $stmt->fetch(); return $row ?: null; }
function user_raw(string $email): ?array { $stmt = db()->prepare('SELECT * FROM users WHERE LOWER(email)=LOWER(?)'); $stmt->execute([$email]); $row = $stmt->fetch(); return $row ?: null; }
function site_row(bool $lock = false): ?array { $stmt = db()->query('SELECT * FROM sites WHERE id=\'nimble\'' . ($lock ? ' FOR UPDATE' : '')); $row = $stmt->fetch(); return $row ?: null; }
function valid_email(mixed $email): bool { return is_string($email) && strlen($email) <= 254 && (bool)preg_match('/^[^\s@]+@[^\s@]+\.[^\s@]+$/', $email); }
function valid_password(mixed $password): bool { return is_string($password) && strlen($password) >= 12 && strlen($password) <= 256; }
function password_digest(string $password): string
{
    $algorithm = defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT;
    $hash = password_hash($password, $algorithm);
    if ($hash === false) throw new RuntimeException('Password hashing is unavailable.');
    return $hash;
}
function create_user(array $body, string $role = 'user'): array
{
    $name = trim((string)($body['name'] ?? '')); $email = strtolower(trim((string)($body['email'] ?? ''))); $password = $body['password'] ?? null;
    if ($name === '' || strlen($name) > 120 || !valid_email($email) || !valid_password($password)) nimble_error('A name, valid email, and a 12–256 character password are required.');
    $stmt = db()->prepare('INSERT INTO users(name,email,password_hash,role,created_at) VALUES(?,?,?,?,?)');
    $stmt->execute([$name, $email, password_digest($password), $role, timestamp()]);
    return user_public((int)db()->lastInsertId()) ?? throw new RuntimeException('Could not create account.');
}
function initial_document(): array
{
    $path = cfg('storage_dir') . '/data/site.json';
    if (is_file($path)) {
        $decoded = json_decode((string)file_get_contents($path), true);
        if (is_array($decoded)) { try { return nimble_normalize($decoded); } catch (Throwable) {} }
    }
    return nimble_default_site();
}
function ensure_site(): void
{
    if (site_row()) return;
    $stmt = db()->query("SELECT id FROM users WHERE role='admin' ORDER BY id LIMIT 1"); $owner = $stmt->fetchColumn();
    if (!$owner) return;
    db_transaction(function () use ($owner): void {
        if (!site_row(true)) {
            $document = json_encode(initial_document(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            $stmt = db()->prepare('INSERT INTO sites(id,owner_id,document_json,revision,updated_at) VALUES(?,?,?,?,?)'); $stmt->execute(['nimble', (int)$owner, $document, 1, timestamp()]);
            db()->prepare('INSERT INTO site_members(site_id,user_id,role,created_at) VALUES(?,?,?,?)')->execute(['nimble', (int)$owner, 'owner', timestamp()]);
        }
    });
}
ensure_site();
function role_for(array $user): ?string
{
    $site = site_row(); if ($site && (int)$site['owner_id'] === (int)$user['id']) return 'owner';
    $stmt = db()->prepare("SELECT role FROM site_members WHERE site_id='nimble' AND user_id=?"); $stmt->execute([(int)$user['id']]); $role = $stmt->fetchColumn(); return $role === false ? null : (string)$role;
}
function cookie_token(): string { return (string)($_COOKIE['nimble_session'] ?? ''); }
function token_hash(string $token): string { return hash('sha256', $token); }
function current_auth(): ?array
{
    $token = cookie_token(); if (!preg_match('/^[a-f0-9]{64}$/', $token)) return null;
    $stmt = db()->prepare('SELECT * FROM sessions WHERE token_hash=? AND expires_at>?'); $stmt->execute([token_hash($token), time()]); $session = $stmt->fetch();
    if (!$session) return null; $user = user_public((int)$session['user_id']); if (!$user) return null; $role = role_for($user); return $role ? ['user' => $user, 'session' => $session, 'role' => $role] : null;
}
function require_access(string $permission = 'view', bool $csrf = false): array
{
    $auth = current_auth(); if (!$auth) nimble_error('Sign in to continue.', 401);
    $rank = ['viewer' => 1, 'editor' => 2, 'admin' => 3, 'owner' => 4]; $minimum = $permission === 'users' ? 3 : (in_array($permission, ['edit', 'publish', 'messages'], true) ? 2 : 1);
    if (($rank[$auth['role']] ?? 0) < $minimum) nimble_error('Your account does not have access to this action.', 403);
    if ($csrf) { $provided = (string)($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''); if ($provided === '' || !hash_equals((string)$auth['session']['csrf_token'], $provided)) nimble_error('Your session changed. Reload before trying again.', 403); }
    return $auth;
}
function session_start_for(int $userId): array
{
    $token = bin2hex(random_bytes(32)); $csrf = bin2hex(random_bytes(24));
    db()->prepare('DELETE FROM sessions WHERE expires_at<?')->execute([time()]);
    db()->prepare('INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at,created_at) VALUES(?,?,?,?,?)')->execute([token_hash($token), $userId, $csrf, time() + ((int)cfg('session_days', 7) * 86400), timestamp()]);
    setcookie('nimble_session', $token, ['expires' => time() + ((int)cfg('session_days', 7) * 86400), 'path' => '/', 'secure' => (bool)cfg('production', true), 'httponly' => true, 'samesite' => 'Lax']);
    return ['csrf' => $csrf];
}
function clear_session_cookie(): void { setcookie('nimble_session', '', ['expires' => time() - 3600, 'path' => '/', 'secure' => (bool)cfg('production', true), 'httponly' => true, 'samesite' => 'Lax']); }
function client_ip(): string { return substr((string)($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'), 0, 64); }
function rate_limit(string $key, int $limit, int $window = 900): void
{
    $now = time(); $pdo = db(); $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare('SELECT count_value,window_until FROM rate_limits WHERE key_name=? FOR UPDATE'); $stmt->execute([$key]); $row = $stmt->fetch();
        if (!$row || (int)$row['window_until'] <= $now) {
            $pdo->prepare('INSERT INTO rate_limits(key_name,count_value,window_until) VALUES(?,?,?) ON DUPLICATE KEY UPDATE count_value=VALUES(count_value),window_until=VALUES(window_until)')->execute([$key, 1, $now + $window]);
        } elseif ((int)$row['count_value'] >= $limit) { throw new NimbleHttpException('Too many requests. Please try again later.', 429); }
        else $pdo->prepare('UPDATE rate_limits SET count_value=count_value+1 WHERE key_name=?')->execute([$key]);
        $pdo->commit();
    } catch (Throwable $error) { if ($pdo->inTransaction()) $pdo->rollBack(); throw $error; }
}
function canonical_path(): string
{
    $raw = (string)(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?? '/');
    $path = rawurldecode($raw);
    if (!str_starts_with($path, '/') || preg_match('/[\\\x00-\x20\x7f%]/', $path) || str_contains($path, '//')) nimble_error('Not found.', 404);
    foreach (explode('/', $path) as $part) if ($part === '.' || $part === '..' || str_starts_with($part, '.')) nimble_error('Not found.', 404);
    return $path === '' ? '/' : $path;
}
function request_method(): string { return strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET')); }
function content_type(): string { return strtolower(trim(explode(';', (string)($_SERVER['CONTENT_TYPE'] ?? ''))[0])); }
function request_body(int $limit = 2000000, bool $form = false): array
{
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0) > $limit) nimble_error('This request is too large.', 413);
    $raw = (string)file_get_contents('php://input'); if (strlen($raw) > $limit) nimble_error('This request is too large.', 413);
    if (content_type() === 'application/json') { $data = json_decode($raw ?: '{}', true); if (!is_array($data)) nimble_error('The request body is invalid.'); return $data; }
    if ($form && (content_type() === 'application/x-www-form-urlencoded' || content_type() === 'multipart/form-data')) return $_POST;
    nimble_error('Send JSON with Content-Type: application/json.', 415);
}
function same_origin(): void
{
    if (!in_array(request_method(), ['POST', 'PUT', 'PATCH', 'DELETE'], true)) return;
    if (($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') nimble_error('Submit this request from the site itself.', 403);
    $origin = (string)($_SERVER['HTTP_ORIGIN'] ?? ''); if ($origin !== '' && rtrim($origin, '/') !== cfg('public_url')) nimble_error('Submit this request from the site itself.', 403);
}
function security_headers(): void
{
    header('X-Content-Type-Options: nosniff'); header('X-Frame-Options: DENY'); header('Referrer-Policy: strict-origin-when-cross-origin'); header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
    header("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; media-src 'self' https:; frame-src https://www.youtube-nocookie.com https://player.vimeo.com; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    if (cfg('production', true)) header('Strict-Transport-Security: max-age=31536000');
}
function json_response(int $status, array $body): never
{
    http_response_code($status); header('Content-Type: application/json; charset=utf-8'); header('Cache-Control: no-store, no-transform'); echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); exit;
}
function html_response(string $html, int $status = 200): never
{
    http_response_code($status); header('Content-Type: text/html; charset=utf-8'); header('Cache-Control: no-store'); echo $html; exit;
}
function redirect_to(string $location): never { header('Location: ' . $location, true, 302); exit; }
function save_document(array $input): array
{
    $document = nimble_normalize($input); $encoded = json_encode($document, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); if (strlen($encoded) > (int)cfg('max_document_bytes', 2000000)) nimble_error('The site document is too large.', 413);
    $expected = (string)($_SERVER['HTTP_IF_MATCH'] ?? ''); if ($expected === '') nimble_error('Reload the latest site before saving.', 428);
    return db_transaction(function () use ($encoded, $expected): array {
        $row = site_row(true); if (!$row || $expected !== '"' . $row['revision'] . '"') nimble_error('Someone else saved a newer version. Reload before saving your changes.', 409);
        if ($encoded !== $row['document_json']) db()->prepare("UPDATE sites SET document_json=?,revision=revision+1,updated_at=? WHERE id='nimble'")->execute([$encoded, timestamp()]);
        return site_row() ?? throw new RuntimeException('Site disappeared during save.');
    });
}
function published_site(): ?array
{
    $row = site_row(); if (!$row || empty($row['published_json'])) return null;
    $decoded = json_decode((string)$row['published_json'], true); return is_array($decoded) ? nimble_normalize($decoded) : null;
}
function template_row(string $id, bool $lock = false): ?array
{
    $stmt = db()->prepare("SELECT * FROM templates WHERE id=? AND site_id='nimble'" . ($lock ? ' FOR UPDATE' : '')); $stmt->execute([$id]); $row = $stmt->fetch(); return $row ?: null;
}
function template_public(array $row): array
{
    $document = json_decode((string)$row['document_json'], true); if (!is_array($document)) throw new RuntimeException('Saved template data is invalid.');
    return ['id' => $row['id'], 'name' => $row['name'], 'description' => $row['description'], 'document' => $document, 'created_at' => $row['created_at'], 'updated_at' => $row['updated_at']];
}
function template_input(array $body, ?array $current = null): array
{
    $name = trim(nimble_text(array_key_exists('name', $body) ? $body['name'] : ($current['name'] ?? null), '', 120));
    $description = trim(nimble_text(array_key_exists('description', $body) ? $body['description'] : ($current['description'] ?? null), '', 500));
    if ($name === '') nimble_error('Template names must be 1–120 characters.');
    $source = array_key_exists('document', $body) ? $body['document'] : ($current ? json_decode((string)$current['document_json'], true) : null);
    if (!is_array($source)) nimble_error('A saved template needs a valid site document.');
    $document = nimble_normalize($source); $encoded = json_encode($document, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($encoded === false || strlen($encoded) > (int)cfg('max_document_bytes', 2000000)) nimble_error('The template document is too large.', 413);
    return ['name' => $name, 'description' => $description, 'document' => $document, 'encoded' => $encoded];
}
function contact_token(string $block): string
{
    $payload = rtrim(strtr(base64_encode(json_encode(['block' => $block, 'expires' => time() + 3600, 'nonce' => bin2hex(random_bytes(8))])), '+/', '-_'), '=');
    $signature = rtrim(strtr(base64_encode(hash_hmac('sha256', $payload, (string)app_setting('contact_secret'), true)), '+/', '-_'), '='); return $payload . '.' . $signature;
}
function contact_token_data(string $token): array
{
    $parts = explode('.', $token); if (count($parts) !== 2) nimble_error('This form is unavailable.');
    $payload = $parts[0]; $expected = rtrim(strtr(base64_encode(hash_hmac('sha256', $payload, (string)app_setting('contact_secret'), true)), '+/', '-_'), '='); if (!hash_equals($expected, $parts[1])) nimble_error('This form is unavailable.');
    $decoded = json_decode(base64_decode(strtr($payload, '-_', '+/') . str_repeat('=', (4 - strlen($payload) % 4) % 4)), true); if (!is_array($decoded) || (int)($decoded['expires'] ?? 0) < time()) nimble_error('This form is unavailable.'); return $decoded;
}
function media_extension(string $type, string $bytes): string
{
    $head = substr($bytes, 0, 16);
    if ($type === 'image/png' && str_starts_with($bytes, "\x89PNG\r\n\x1a\n")) return 'png';
    if ($type === 'image/jpeg' && substr($bytes, 0, 3) === "\xff\xd8\xff") return 'jpg';
    if ($type === 'image/gif' && preg_match('/^GIF8[79]a/', $head)) return 'gif';
    if ($type === 'image/webp' && substr($bytes, 0, 4) === 'RIFF' && substr($bytes, 8, 4) === 'WEBP') return 'webp';
    if ($type === 'video/mp4' && substr($bytes, 4, 4) === 'ftyp') return 'mp4';
    if ($type === 'video/webm' && substr($bytes, 0, 4) === "\x1a\x45\xdf\xa3") return 'webm';
    nimble_error('The file contents do not match a supported image or video format.'); return '';
}
function media_size(): int
{
    $total = 0; foreach (glob(cfg('storage_dir') . '/uploads/*') ?: [] as $file) if (is_file($file)) $total += (int)filesize($file); return $total;
}
function store_media(array $body): array
{
    $data = (string)($body['data'] ?? ''); if (!preg_match('#^data:(image/(?:png|jpeg|webp|gif)|video/(?:mp4|webm));base64,([a-z0-9+/]+={0,2})$#i', $data, $match)) nimble_error('Upload an image or video no larger than 15 MB.');
    $bytes = base64_decode($match[2], true); if ($bytes === false || strlen($bytes) > (int)cfg('max_media_bytes', 15728640) || media_size() + strlen($bytes) > (int)cfg('media_quota_bytes', 1073741824)) nimble_error('Invalid media encoding, file size, or storage quota.', 413);
    $extension = media_extension(strtolower($match[1]), $bytes); $filename = bin2hex(random_bytes(16)) . '.' . $extension; $path = cfg('storage_dir') . '/uploads/' . $filename;
    if (file_put_contents($path, $bytes, LOCK_EX) === false) throw new RuntimeException('Could not store the upload.');
    return ['url' => '/uploads/' . $filename, 'name' => substr((string)($body['name'] ?? 'Media'), 0, 200), 'kind' => str_starts_with(strtolower($match[1]), 'video') ? 'video' : 'image'];
}
function serve_upload(string $path): never
{
    if (!preg_match('#^/uploads/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|gif|mp4|webm)$#', $path)) nimble_error('Not found.', 404);
    $file = cfg('storage_dir') . '/uploads/' . basename($path); if (!is_file($file)) nimble_error('Not found.', 404); $size = filesize($file); $start = 0; $end = $size - 1; $status = 200;
    header('Accept-Ranges: bytes');
    $range = (string)($_SERVER['HTTP_RANGE'] ?? '');
    if ($range !== '') {
        if (!preg_match('/^bytes=(\d*)-(\d*)$/', $range, $match) || ($match[1] === '' && $match[2] === '')) nimble_error('Invalid media range.', 416);
        if ($match[1] === '') $start = max(0, $size - (int)$match[2]); else { $start = (int)$match[1]; if ($match[2] !== '') $end = min($end, (int)$match[2]); }
        if ($start > $end || $start >= $size) { header('Content-Range: bytes */' . $size); nimble_error('Invalid media range.', 416); }
        $status = 206; header('Content-Range: bytes ' . $start . '-' . $end . '/' . $size);
    }
    $mime = ['png'=>'image/png','jpg'=>'image/jpeg','jpeg'=>'image/jpeg','webp'=>'image/webp','gif'=>'image/gif','mp4'=>'video/mp4','webm'=>'video/webm'][strtolower(pathinfo($file, PATHINFO_EXTENSION))] ?? 'application/octet-stream';
    http_response_code($status); header('Content-Type: ' . $mime); header('Content-Length: ' . max(0, $end - $start + 1)); header('Cache-Control: public, max-age=31536000, immutable');
    if (request_method() === 'HEAD' || $size === 0) exit;
    $handle = fopen($file, 'rb'); fseek($handle, $start); $remaining = $end - $start + 1; while ($remaining > 0 && !feof($handle)) { $chunk = fread($handle, min(1048576, $remaining)); if ($chunk === false) break; echo $chunk; $remaining -= strlen($chunk); } fclose($handle); exit;
}
function public_page_for(string $path, array $site): ?array
{
    $local = str_starts_with($path, '/published/') ? substr($path, 10) : $path;
    foreach ($site['pages'] as $page) if ($local === $page['path'] || $local === '/' . $page['id'] . '.html' || ($page['id'] === 'home' && in_array($local, ['/', '/index.html'], true))) return $page;
    return null;
}

security_headers();
try {
    $path = canonical_path(); $method = request_method(); same_origin();
    if ($path === '/api/health' && $method === 'GET') json_response(200, ['ok' => true, 'application' => 'nimble-studio']);
    if ($path === '/api/ready' && $method === 'GET') {
        foreach ([$storage, $dataDir, $uploadsDir] as $directory) { $probe = $directory . '/.ready-' . bin2hex(random_bytes(8)); if (file_put_contents($probe, '') === false) throw new RuntimeException('Storage is not writable.'); unlink($probe); }
        $ready = site_row() !== null; json_response($ready ? 200 : 503, ['ok' => $ready, 'application' => 'nimble-studio', 'setupRequired' => !$ready]);
    }
    if ($path === '/api/auth/setup-status' && $method === 'GET') json_response(200, ['setupRequired' => site_row() === null, 'tokenRequired' => true]);
    if ($path === '/api/auth/setup' && $method === 'POST') {
        rate_limit('setup:' . client_ip(), 10); $body = request_body(10000); $setupToken = (string)cfg('setup_token', ''); if ($setupToken === '' || !hash_equals($setupToken, (string)($body['setupToken'] ?? ''))) nimble_error('Use the private setup token supplied by the site administrator.', 403);
        $account = db_transaction(function () use ($body): array {
            if (db()->query('SELECT id FROM users LIMIT 1')->fetchColumn() || site_row(true)) nimble_error('Owner setup is already complete.', 409);
            $user = create_user($body, 'admin'); $document = json_encode(initial_document(), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); db()->prepare('INSERT INTO sites(id,owner_id,document_json,revision,updated_at) VALUES(?,?,?,?,?)')->execute(['nimble', $user['id'], $document, 1, timestamp()]); db()->prepare('INSERT INTO site_members(site_id,user_id,role,created_at) VALUES(?,?,?,?)')->execute(['nimble', $user['id'], 'owner', timestamp()]); audit((int)$user['id'], 'owner_provisioned'); return $user;
        });
        $session = session_start_for((int)$account['id']); json_response(201, ['user' => $account, 'csrf' => $session['csrf'], 'role' => 'owner']);
    }
    if ($path === '/api/auth/login' && $method === 'POST') {
        rate_limit('login-ip:' . client_ip(), 60); $body = request_body(10000); $email = strtolower(trim((string)($body['email'] ?? ''))); rate_limit('login-account:' . $email, 12); $user = user_raw($email);
        if (!$user || !password_verify((string)($body['password'] ?? ''), (string)$user['password_hash'])) nimble_error('Email or password is incorrect.', 401);
        if (password_needs_rehash((string)$user['password_hash'], defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT)) db()->prepare('UPDATE users SET password_hash=? WHERE id=?')->execute([password_digest((string)$body['password']), $user['id']]);
        $session = session_start_for((int)$user['id']); audit((int)$user['id'], 'login'); json_response(200, ['user' => user_public((int)$user['id']), 'csrf' => $session['csrf'], 'role' => role_for($user)]);
    }
    if ($path === '/api/auth/me' && $method === 'GET') { $auth = require_access(); json_response(200, ['user' => $auth['user'], 'csrf' => $auth['session']['csrf_token'], 'role' => $auth['role']]); }
    if ($path === '/api/auth/logout' && $method === 'POST') { $auth = require_access('view', true); db()->prepare('DELETE FROM sessions WHERE token_hash=?')->execute([$auth['session']['token_hash']]); clear_session_cookie(); json_response(200, ['ok' => true]); }
    if ($path === '/api/auth/password' && $method === 'POST') {
        $auth = require_access('view', true); rate_limit('password:' . $auth['user']['id'], 8); $body = request_body(10000); $old = user_raw($auth['user']['email']); if (!$old || !password_verify((string)($body['currentPassword'] ?? ''), $old['password_hash'])) nimble_error('Your current password is incorrect.', 403); if (!valid_password($body['password'] ?? null)) nimble_error('Use a password of 12–256 characters.');
        db_transaction(function () use ($auth, $body, $old): void { $result = db()->prepare('UPDATE users SET password_hash=? WHERE id=? AND password_hash=?'); $result->execute([password_digest($body['password']), $auth['user']['id'], $old['password_hash']]); if (!$result->rowCount()) nimble_error('Your credentials changed. Sign in again.', 409); db()->prepare('DELETE FROM sessions WHERE user_id=?')->execute([$auth['user']['id']]); audit((int)$auth['user']['id'], 'password_changed'); });
        $session = session_start_for((int)$auth['user']['id']); json_response(200, ['csrf' => $session['csrf']]);
    }
    if ($path === '/api/site' && $method === 'GET') { $auth = require_access(); $row = site_row(); if (!$row) nimble_error('Owner setup is incomplete.', 503); header('ETag: "' . $row['revision'] . '"'); json_response(200, ['site' => json_decode($row['document_json'], true), 'revision' => (int)$row['revision'], 'role' => $auth['role']]); }
    if ($path === '/api/site' && $method === 'PUT') { $auth = require_access('edit', true); $row = save_document(request_body((int)cfg('max_document_bytes', 2000000))); audit((int)$auth['user']['id'], 'site_saved', ['revision' => (int)$row['revision']]); header('ETag: "' . $row['revision'] . '"'); json_response(200, ['site' => json_decode($row['document_json'], true), 'revision' => (int)$row['revision']]); }
    if ($path === '/api/templates' && $method === 'GET') { require_access('edit'); $rows = db()->query("SELECT * FROM templates WHERE site_id='nimble' ORDER BY updated_at DESC,name ASC")->fetchAll(); json_response(200, ['templates' => array_map('template_public', $rows)]); }
    if ($path === '/api/templates' && $method === 'POST') {
        $auth = require_access('edit', true); $input = template_input(request_body((int)cfg('max_document_bytes', 2000000)));
        $row = db_transaction(function () use ($auth, $input): array {
            if (!site_row(true)) nimble_error('Owner setup is incomplete.', 503);
            $count = (int)db()->query("SELECT COUNT(*) FROM templates WHERE site_id='nimble'")->fetchColumn(); if ($count >= 50) nimble_error('You can save up to 50 templates for this site.', 409);
            $duplicate = db()->prepare("SELECT id FROM templates WHERE site_id='nimble' AND name=?"); $duplicate->execute([$input['name']]); if ($duplicate->fetchColumn()) nimble_error('A template with that name already exists.', 409);
            $id = bin2hex(random_bytes(16)); $now = timestamp(); db()->prepare('INSERT INTO templates(id,site_id,name,description,document_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')->execute([$id, 'nimble', $input['name'], $input['description'], $input['encoded'], $now, $now]); audit((int)$auth['user']['id'], 'template_created', ['templateId' => $id, 'name' => $input['name']]); return template_row($id) ?? throw new RuntimeException('Template disappeared after saving.');
        });
        json_response(201, ['template' => template_public($row)]);
    }
    if (preg_match('#^/api/templates/([a-f0-9-]{8,80})$#i', $path, $match) && in_array($method, ['PUT', 'DELETE'], true)) {
        $auth = require_access('edit', true); $id = $match[1]; $existing = template_row($id); if (!$existing) nimble_error('Template not found.', 404);
        if ($method === 'DELETE') { db_transaction(function () use ($auth, $id): void { db()->prepare("DELETE FROM templates WHERE id=? AND site_id='nimble'")->execute([$id]); audit((int)$auth['user']['id'], 'template_deleted', ['templateId' => $id]); }); json_response(200, ['ok' => true]); }
        $input = template_input(request_body((int)cfg('max_document_bytes', 2000000)), $existing);
        $row = db_transaction(function () use ($auth, $id, $input): array {
            $duplicate = db()->prepare("SELECT id FROM templates WHERE site_id='nimble' AND name=? AND id<>?"); $duplicate->execute([$input['name'], $id]); if ($duplicate->fetchColumn()) nimble_error('A template with that name already exists.', 409);
            db()->prepare("UPDATE templates SET name=?,description=?,document_json=?,updated_at=? WHERE id=? AND site_id='nimble'")->execute([$input['name'], $input['description'], $input['encoded'], timestamp(), $id]); audit((int)$auth['user']['id'], 'template_updated', ['templateId' => $id, 'name' => $input['name']]); return template_row($id) ?? throw new RuntimeException('Template disappeared after updating.');
        });
        json_response(200, ['template' => template_public($row)]);
    }
    if ($path === '/api/media' && $method === 'POST') { $auth = require_access('edit', true); $result = store_media(request_body(22000000)); audit((int)$auth['user']['id'], 'media_uploaded', ['url' => $result['url']]); json_response(201, $result); }
    if ($path === '/api/publish' && $method === 'POST') {
        $auth = require_access('publish', true); $body = request_body(10000); $row = db_transaction(function () use ($body): array { $row = site_row(true); if (!$row) nimble_error('Owner setup is incomplete.', 503); if ((int)($body['revision'] ?? 0) !== (int)$row['revision']) nimble_error('Save and load the latest draft before publishing.', 409); db()->prepare("UPDATE sites SET published_json=document_json,published_revision=revision,published_at=? WHERE id='nimble'")->execute([timestamp()]); return site_row() ?? $row; }); audit((int)$auth['user']['id'], 'site_published', ['revision' => (int)$row['revision']]); json_response(200, ['ok' => true, 'url' => cfg('public_url') . '/']);
    }
    if ($path === '/api/preview' && $method === 'POST') { require_access('view', true); $body = request_body((int)cfg('max_document_bytes', 2000000)); $document = nimble_normalize($body['site'] ?? []); $page = $document['pages'][0]; foreach ($document['pages'] as $candidate) if (($candidate['id'] ?? '') === ($body['pageId'] ?? '')) $page = $candidate; html_response(nimble_render_page($document, $page)); }
    if ($path === '/api/admin/users' && $method === 'GET') { require_access('users'); $rows = db()->query("SELECT u.id,u.name,u.email,u.created_at,m.role AS site_role FROM users u JOIN site_members m ON m.user_id=u.id AND m.site_id='nimble' ORDER BY u.id")->fetchAll(); json_response(200, ['users' => $rows]); }
    if ($path === '/api/admin/users' && $method === 'POST') { $auth = require_access('users', true); $body = request_body(10000); if (!in_array($body['role'] ?? '', ['admin', 'editor', 'viewer'], true)) nimble_error('Choose a valid role.'); $user = db_transaction(function () use ($body, $auth): array { $account = create_user($body, $body['role'] === 'admin' ? 'admin' : 'user'); db()->prepare('INSERT INTO site_members(site_id,user_id,role,created_at) VALUES(?,?,?,?)')->execute(['nimble', $account['id'], $body['role'], timestamp()]); audit((int)$auth['user']['id'], 'user_created', ['userId' => $account['id']]); return $account; }); json_response(201, ['user' => $user]); }
    if (preg_match('#^/api/admin/users/([0-9]+)(/reset-password)?$#', $path, $match) && in_array($method, ['PATCH', 'DELETE', 'POST'], true)) {
        $auth = require_access('users', true); $id = (int)$match[1]; $target = user_public($id); if (!$target) nimble_error('User not found.', 404); $site = site_row(); if ($id === (int)$auth['user']['id'] || ($site && $id === (int)$site['owner_id'])) nimble_error('You cannot modify your own access or the site owner here.');
        if ($method === 'DELETE' && empty($match[2])) { db()->prepare('DELETE FROM users WHERE id=?')->execute([$id]); audit((int)$auth['user']['id'], 'user_removed', ['userId' => $id]); json_response(200, ['ok' => true]); }
        $body = request_body(10000);
        if ($method === 'PATCH' && empty($match[2])) { if (!in_array($body['role'] ?? '', ['admin', 'editor', 'viewer'], true)) nimble_error('Choose a valid role.'); db_transaction(function () use ($body, $id, $auth): void { db()->prepare('UPDATE users SET role=? WHERE id=?')->execute([$body['role'] === 'admin' ? 'admin' : 'user', $id]); db()->prepare("UPDATE site_members SET role=? WHERE site_id='nimble' AND user_id=?")->execute([$body['role'], $id]); db()->prepare('DELETE FROM sessions WHERE user_id=?')->execute([$id]); audit((int)$auth['user']['id'], 'user_role_changed', ['userId' => $id, 'role' => $body['role']]); }); json_response(200, ['ok' => true]); }
        if ($method === 'POST' && !empty($match[2])) { if (!valid_password($body['password'] ?? null)) nimble_error('Use a password of 12–256 characters.'); db_transaction(function () use ($body, $id, $auth): void { db()->prepare('UPDATE users SET password_hash=? WHERE id=?')->execute([password_digest($body['password']), $id]); db()->prepare('DELETE FROM sessions WHERE user_id=?')->execute([$id]); audit((int)$auth['user']['id'], 'user_password_reset', ['userId' => $id]); }); json_response(200, ['ok' => true]); }
        nimble_error('Method not allowed.', 405);
    }
    if ($path === '/api/messages' && $method === 'GET') { require_access('messages'); $before = max(0, (int)($_GET['before'] ?? PHP_INT_MAX)); $stmt = db()->prepare('SELECT * FROM messages WHERE id<? ORDER BY id DESC LIMIT 100'); $stmt->execute([$before]); $messages = $stmt->fetchAll(); json_response(200, ['messages' => $messages, 'nextBefore' => count($messages) === 100 ? (int)$messages[count($messages) - 1]['id'] : null]); }
    if (preg_match('#^/api/messages/[0-9]+$#', $path) && $method === 'DELETE') { $auth = require_access('messages', true); $id = (int)basename($path); db()->prepare('DELETE FROM messages WHERE id=?')->execute([$id]); audit((int)$auth['user']['id'], 'message_deleted', ['id' => $id]); json_response(200, ['ok' => true]); }
    if ($path === '/api/contact-token' && $method === 'GET') { rate_limit('contact-token:' . client_ip(), 100); $site = published_site(); $block = (string)($_GET['block'] ?? ''); $found = false; if ($site) foreach ($site['pages'] as $page) if (in_array($block, $page['blocks'], true)) $found = true; if (!$site || !$found || (($site['blocks'][$block]['type'] ?? '') !== 'form')) nimble_error('This form is unavailable.', 404); json_response(200, ['token' => contact_token($block)]); }
    if ($path === '/api/contact' && $method === 'POST') {
        rate_limit('contact:' . client_ip(), 5); $body = request_body(15000, true); $token = contact_token_data((string)($body['token'] ?? '')); $site = published_site(); $found = false; if ($site) foreach ($site['pages'] as $page) if (in_array($token['block'] ?? '', $page['blocks'], true)) $found = true; if (!$site || !$found || (($site['blocks'][$token['block']]['type'] ?? '') !== 'form')) nimble_error('This form is unavailable.'); if (!empty($body['website'])) json_response(200, ['ok' => true]);
        $name = trim((string)($body['name'] ?? '')); $email = strtolower(trim((string)($body['email'] ?? ''))); $message = trim((string)($body['message'] ?? '')); if ($name === '' || strlen($name) > 120 || !valid_email($email) || $message === '' || strlen($message) > 5000) nimble_error('Enter your name, a valid email, and a message of at most 5,000 characters.'); db()->prepare('INSERT INTO messages(name,email,message,page_id,created_at) VALUES(?,?,?,?,?)')->execute([$name, $email, $message, (string)$token['block'], timestamp()]); json_response(201, ['ok' => true]);
    }
    if (str_starts_with($path, '/api/')) nimble_error('Endpoint not found.', 404);
    if ($path === '/uploads/' || str_starts_with($path, '/uploads/')) serve_upload($path);
    if ($path === '/builder' || $path === '/control-panel') redirect_to($path . '.html');
    if (in_array($path, ['/builder.html', '/control-panel.html'], true)) { require_access(); $file = __DIR__ . $path; if (!is_file($file)) nimble_error('Not found.', 404); header('Content-Type: text/html; charset=utf-8'); header('Cache-Control: no-store'); readfile($file); exit; }
    if ($path === '/robots.txt') { $site = published_site(); header('Content-Type: text/plain; charset=utf-8'); echo "User-agent: *\n" . (!empty($site['site']['searchVisible']) ? "Allow: /\nDisallow: /api/\nDisallow: /builder.html\nDisallow: /control-panel.html\n" : "Disallow: /\n"); exit; }
    $site = published_site(); if ($path === '/sitemap.xml' && $site) { header('Content-Type: application/xml; charset=utf-8'); $xml = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'; foreach ($site['pages'] as $page) $xml .= '<url><loc>' . nimble_escape(cfg('public_url') . ($page['id'] === 'home' ? '/' : '/' . $page['id'] . '.html')) . '</loc></url>'; echo $xml . '</urlset>'; exit; }
    if ($site) { $page = public_page_for($path, $site); if ($page) html_response(nimble_render_page($site, $page)); }
    if ($path === '/') html_response('<!doctype html><title>Nimble</title><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/assets/public.css"><main class="wrap block"><h1>Nimble</h1><p>Your new website is on its way.</p><a href="/login.html">Team sign in</a></main>');
    nimble_error('Not found.', 404);
} catch (Throwable $error) {
    $status = $error instanceof NimbleHttpException ? $error->getCode() : 500;
    if ($status < 400 || $status > 599) $status = 500;
    if ($status >= 500) error_log(json_encode(['event' => 'request_failed', 'error' => $error->getMessage()]));
    if (!headers_sent()) json_response($status, ['error' => $status === 500 ? 'The server could not complete this request.' : $error->getMessage()]);
}
