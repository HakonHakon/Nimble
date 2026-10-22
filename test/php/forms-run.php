<?php
declare(strict_types=1);
// Test harness: validates form submissions with the PHP implementation.
require_once __DIR__ . '/../../php-backend/lib/site-model.php';
require_once __DIR__ . '/../../php-backend/lib/site-model-v2.php';
require_once __DIR__ . '/../../php-backend/lib/forms.php';
$input = json_decode((string)stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
$out = [];
foreach ($input['cases'] as $case) {
    try {
        $result = nimble_validate_submission($input['fields'], $case);
        $out[] = ['entries' => $result['entries'], 'files' => array_map(static fn($file) => [$file['extension'], strlen($file['bytes'])], $result['files']), 'name' => $result['name'], 'email' => $result['email'], 'message' => $result['message']];
    } catch (NimbleHttpException $error) { $out[] = ['error' => $error->getMessage()]; }
}
echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
