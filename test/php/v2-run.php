<?php
declare(strict_types=1);
// Test harness: reads {"document":…,"year":…} on stdin, prints the PHP v2 normalization and rendering.
require_once __DIR__ . '/../../php-backend/lib/site-model.php';
require_once __DIR__ . '/../../php-backend/lib/site-model-v2.php';
require_once __DIR__ . '/../../php-backend/lib/render-v2.php';
$input = json_decode((string)stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
try {
    $site = nimble_v2_normalize($input['document']);
    $pages = [];
    foreach ($site['pages'] as $page) $pages[$page['id']] = nimble_v2_render_page($site, $page, ['year' => $input['year']]);
    echo json_encode(['site' => $site, 'pages' => $pages], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
} catch (NimbleHttpException $error) {
    echo json_encode(['error' => $error->getMessage()], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
}
