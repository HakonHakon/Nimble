<?php
declare(strict_types=1);
// Test harness: parses Google Fonts CSS and builds request URLs with the PHP implementation.
require_once __DIR__ . '/../../php-backend/lib/site-model.php';
require_once __DIR__ . '/../../php-backend/lib/fonts.php';
$input = json_decode((string)stream_get_contents(STDIN), true, 512, JSON_THROW_ON_ERROR);
$out = [];
foreach ($input['requests'] as $request) {
    $result = nimble_font_request($request);
    $out['requests'][] = isset($result['error']) ? $result : $result + ['url' => nimble_font_css_url('https://fonts.example', $result)];
}
foreach ($input['css'] as $css) $out['faces'][] = nimble_parse_font_css($css);
foreach ($input['urls'] as [$url, $base]) $out['allowed'][] = nimble_allowed_font_url($url, $base);
echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
