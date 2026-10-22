<?php
declare(strict_types=1);
// Self-hosted Google Fonts. 1:1 port of lib/fonts.mjs (parsing is covered by test/v2-parity.test.mjs).

function nimble_font_request(mixed $input): array
{
    $family = is_array($input) && is_string($input['family'] ?? null) ? preg_replace('/\s+/', ' ', trim($input['family'])) : '';
    if (!preg_match('/^[A-Za-z0-9 ]{1,60}$/', $family)) return ['error' => 'Enter a font family name using letters, numbers and spaces.'];
    $weights = is_array($input['weights'] ?? null) && $input['weights'] ? array_values(array_unique($input['weights'], SORT_REGULAR)) : [400, 700];
    sort($weights);
    if (count($weights) > 6) return ['error' => 'Choose up to 6 weights between 100 and 900.'];
    foreach ($weights as $weight) if (!is_int($weight) || $weight < 100 || $weight > 900 || $weight % 100) return ['error' => 'Choose up to 6 weights between 100 and 900.'];
    return ['family' => $family, 'weights' => $weights, 'italic' => ($input['italic'] ?? null) === true];
}
function nimble_font_css_url(string $base, array $request): string
{
    if ($request['italic']) {
        $pairs = [];
        foreach ([0, 1] as $italic) foreach ($request['weights'] as $weight) $pairs[] = $italic . ',' . $weight;
        $axis = 'ital,wght@' . implode(';', $pairs);
    } else $axis = 'wght@' . implode(';', $request['weights']);
    return rtrim($base, '/') . '/css2?family=' . str_replace(' ', '+', $request['family']) . ':' . $axis . '&display=swap';
}
function nimble_parse_font_css(string $css): array
{
    preg_match_all('/(?:\/\*\s*([a-z0-9-]+)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/i', $css, $matches, PREG_SET_ORDER);
    $pick = [];
    foreach ($matches as $match) {
        $body = $match[2];
        if (!preg_match('/src:\s*url\(\s*[\'"]?([^\'")\s]+)[\'"]?\s*\)\s*format\(\s*[\'"]woff2[\'"]\s*\)/i', $body, $url)) continue;
        $weight = preg_match('/font-weight:\s*(\d{3})\s*;/i', $body, $w) ? (int)$w[1] : 400;
        $style = preg_match('/font-style:\s*italic/i', $body) ? 'italic' : 'normal';
        $subset = $match[1] ?? '';
        $key = $weight . ':' . $style;
        if (!isset($pick[$key]) || ($subset === 'latin' && $pick[$key]['subset'] !== 'latin')) $pick[$key] = ['subset' => $subset, 'weight' => $weight, 'style' => $style, 'url' => $url[1]];
    }
    $faces = array_values($pick);
    usort($faces, static fn($a, $b) => $a['weight'] <=> $b['weight'] ?: strcmp($a['style'], $b['style']));
    return array_map(static fn($face) => ['weight' => $face['weight'], 'style' => $face['style'], 'url' => $face['url']], $faces);
}
function nimble_allowed_font_url(string $url, string $base): bool
{
    $target = parse_url($url); $origin = parse_url($base);
    if (!$target || !$origin || isset($target['user']) || isset($target['pass'])) return false;
    if (($target['scheme'] ?? '') === 'https' && ($target['host'] ?? '') === 'fonts.gstatic.com') return true;
    $originOf = static fn($parts) => strtolower(($parts['scheme'] ?? '') . '://' . ($parts['host'] ?? '') . ':' . ($parts['port'] ?? (($parts['scheme'] ?? '') === 'https' ? 443 : 80)));
    return $originOf($target) === $originOf($origin);
}
// GET with a timeout and no redirects; returns [status, body] or null when the host cannot be reached.
function nimble_http_get(string $url, int $limit): ?array
{
    $agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
    if (function_exists('curl_init')) {
        $handle = curl_init($url);
        curl_setopt_array($handle, [CURLOPT_RETURNTRANSFER => true, CURLOPT_FOLLOWLOCATION => false, CURLOPT_TIMEOUT => 15, CURLOPT_USERAGENT => $agent, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS | CURLPROTO_HTTP]);
        $body = curl_exec($handle); $status = (int)curl_getinfo($handle, CURLINFO_RESPONSE_CODE); curl_close($handle);
        return $body === false ? null : [$status, substr((string)$body, 0, $limit + 1)];
    }
    $context = stream_context_create(['http' => ['timeout' => 15, 'follow_location' => 0, 'ignore_errors' => true, 'header' => 'User-Agent: ' . $agent . "\r\n"]]);
    $body = @file_get_contents($url, false, $context, 0, $limit + 1);
    if ($body === false) return null;
    $status = isset($http_response_header[0]) && preg_match('/\s(\d{3})\s?/', $http_response_header[0], $m) ? (int)$m[1] : 0;
    return [$status, $body];
}
function nimble_import_google_font(mixed $body, callable $store): array
{
    $request = nimble_font_request($body);
    if (isset($request['error'])) nimble_error($request['error']);
    $base = (string)cfg('google_fonts_url', 'https://fonts.googleapis.com');
    $response = nimble_http_get(nimble_font_css_url($base, $request), 200000);
    if ($response === null) nimble_error('Google Fonts could not be reached from this server.', 502);
    if ($response[0] === 400 || $response[0] === 404) nimble_error('Google Fonts has no family called ' . $request['family'] . ' with those weights.', 404);
    if ($response[0] < 200 || $response[0] > 299) nimble_error('Google Fonts returned an error (' . $response[0] . ').', 502);
    $faces = nimble_parse_font_css($response[1]);
    if (!$faces) nimble_error('Google Fonts has no web font files for ' . $request['family'] . '.', 404);
    $files = [];
    foreach (array_slice($faces, 0, 12) as $face) {
        if (!nimble_allowed_font_url($face['url'], $base)) nimble_error('Google Fonts returned an unexpected file address.', 502);
        $file = nimble_http_get($face['url'], 2000000);
        if ($file === null || $file[0] !== 200 || strlen($file[1]) > 2000000 || substr($file[1], 0, 4) !== 'wOF2') nimble_error('A font file was not a valid WOFF2 file.', 502);
        $stored = $store($file[1], 'woff2', $request['family'] . ' ' . $face['weight'] . ($face['style'] === 'italic' ? ' italic' : ''));
        $files[] = ['src' => $stored['url'], 'weight' => $face['weight'], 'style' => $face['style']];
    }
    return ['family' => $request['family'], 'files' => $files];
}
