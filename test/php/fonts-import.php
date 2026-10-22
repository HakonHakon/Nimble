<?php
declare(strict_types=1);
// Test harness: runs the PHP Google Fonts import against a mock CSS host given as argv[1].
require_once __DIR__ . '/../../php-backend/lib/site-model.php';
require_once __DIR__ . '/../../php-backend/lib/fonts.php';
$config = ['google_fonts_url' => $argv[1]];
function cfg(string $key, mixed $fallback = null): mixed { global $config; return $config[$key] ?? $fallback; }
$stored = [];
try {
    $result = nimble_import_google_font(json_decode($argv[2], true), function (string $bytes, string $extension, string $name) use (&$stored): array {
        $stored[] = ['bytes' => strlen($bytes), 'extension' => $extension, 'name' => $name];
        return ['url' => '/uploads/font-' . count($stored) . '.' . $extension];
    });
    echo json_encode(['result' => $result, 'stored' => $stored], JSON_UNESCAPED_SLASHES);
} catch (NimbleHttpException $error) {
    echo json_encode(['error' => $error->getMessage(), 'status' => $error->getCode()]);
}
