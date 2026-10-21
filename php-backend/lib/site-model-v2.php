<?php
declare(strict_types=1);
// Site document v2. 1:1 port of lib/site-model-v2.mjs — keep both in sync (test/v2-parity.test.mjs).
require_once __DIR__ . '/site-model.php';

function nimble_v2_spec(): array
{
    static $spec = null;
    if ($spec === null) {
        // Release packages ship the spec next to this file; the repository keeps one shared copy in /lib.
        $file = is_file(__DIR__ . '/nimble-spec.json') ? __DIR__ . '/nimble-spec.json' : __DIR__ . '/../../lib/nimble-spec.json';
        $spec = json_decode((string)file_get_contents($file), true, 64, JSON_THROW_ON_ERROR);
    }
    return $spec;
}
function nimble_v2_match(string $pattern, mixed $value, ?array &$match = null): bool
{
    static $compiled = [];
    if (!is_string($value)) return false;
    $regex = $compiled[$pattern] ??= '/' . str_replace('/', '\/', nimble_v2_spec()['patterns'][$pattern]) . '/u';
    return (bool)preg_match($regex, $value, $match);
}
function nimble_v2_is_object(mixed $value): bool { return is_array($value) && ($value === [] || !array_is_list($value)); }
function nimble_v2_is_list(mixed $value): bool { return is_array($value) && array_is_list($value); }
function nimble_v2_has(array $value, string $key): bool { return array_key_exists($key, $value) && $value[$key] !== null; }
function nimble_v2_chars(string $value): int { return mb_strlen($value, 'UTF-8'); }
function nimble_v2_is_number(mixed $value): bool { return (is_int($value) || is_float($value)) && is_finite((float)$value); }
function nimble_v2_is_integer(mixed $value): bool { return is_int($value) || (is_float($value) && is_finite($value) && floor($value) === $value); }
function nimble_v2_round(float|int $value): float|int
{
    $result = floor($value * 1000 + 0.5) / 1000;
    if ($result == 0) return 0;
    return floor($result) === $result && abs($result) < 1e15 ? (int)$result : $result;
}
function nimble_v2_num_string(float|int $value): string
{
    if (is_int($value)) return (string)$value;
    if (floor($value) === $value && abs($value) < 1e15) return (string)(int)$value;
    return (string)$value;
}
function nimble_v2_text(mixed $value, int $limit, string $label = 'Text'): string
{
    if ($value === null) return '';
    if (!is_string($value) || nimble_v2_chars($value) > $limit) nimble_error($label . ' must be text of at most ' . $limit . ' characters.');
    return str_replace("\0", '', $value);
}
function nimble_v2_safe_url(mixed $value): string
{
    if (!is_string($value) || strlen($value) > 3000 || preg_match('/[\x00-\x20\x7f\\\\<>"\']/', $value)) return '';
    if (str_starts_with($value, '/') && !str_starts_with($value, '//')) return $value;
    return nimble_v2_match('url', $value) ? $value : '';
}
function nimble_v2_video_source(mixed $value): ?array
{
    $candidate = nimble_v2_safe_url($value);
    if ($candidate === '') return null;
    if (str_starts_with($candidate, '/uploads/') || preg_match('/\.(mp4|webm)(?:[?#]|$)/i', $candidate)) return ['kind' => 'file', 'url' => $candidate];
    $parts = parse_url($candidate);
    if (!$parts) return null;
    $host = preg_replace('/^www\./', '', strtolower((string)($parts['host'] ?? '')));
    $id = null;
    if ($host === 'youtu.be') $id = substr((string)($parts['path'] ?? ''), 1);
    if (in_array($host, ['youtube.com', 'm.youtube.com', 'youtube-nocookie.com'], true)) {
        parse_str((string)($parts['query'] ?? ''), $query);
        $v = $query['v'] ?? '';
        $id = is_string($v) && $v !== '' ? $v : (preg_match('#^/(?:embed|shorts)/([^/]+)#', (string)($parts['path'] ?? ''), $m) ? $m[1] : null);
    }
    if ($id !== null && preg_match('/^[a-z0-9_-]{6,24}$/i', $id)) return ['kind' => 'embed', 'url' => 'https://www.youtube-nocookie.com/embed/' . $id];
    if (in_array($host, ['vimeo.com', 'player.vimeo.com'], true) && preg_match('#(?:^|/)(\d{3,15})$#', (string)($parts['path'] ?? ''), $m)) return ['kind' => 'embed', 'url' => 'https://player.vimeo.com/video/' . $m[1]];
    return null;
}
function nimble_v2_length(mixed $value, bool $signed = false, bool $auto = false): ?string
{
    if ($auto && $value === 'auto') return 'auto';
    if ($value === 0 || $value === '0') return '0px';
    if (!is_string($value) || !nimble_v2_match('length', $value, $m)) return null;
    if ($m[1] !== '' && !$signed) return null;
    $number = (float)$m[2];
    return $number == 0 ? '0px' : $m[1] . nimble_v2_num_string($number) . $m[3];
}
function nimble_v2_fr(string $token): string { return nimble_v2_num_string((float)substr($token, 0, -2)) . 'fr'; }
function nimble_v2_track(mixed $value): ?string
{
    if (!is_string($value) || strlen($value) > 80) return null;
    $token = preg_replace('/\s+/', '', $value);
    if ($token === 'auto') return $token;
    if (nimble_v2_match('fr', $token)) return nimble_v2_fr($token);
    $plain = nimble_v2_length($token);
    if ($plain !== null) return $plain;
    if (nimble_v2_match('minmax', $token, $m)) {
        $low = $m[1] === 'auto' ? 'auto' : nimble_v2_length($m[1]);
        $high = $m[2] === 'auto' ? 'auto' : (nimble_v2_match('fr', $m[2]) ? nimble_v2_fr($m[2]) : nimble_v2_length($m[2]));
        return $low !== null && $high !== null ? 'minmax(' . $low . ',' . $high . ')' : null;
    }
    if (nimble_v2_match('repeat', $token, $m)) {
        $low = nimble_v2_length($m[2]);
        return $low !== null ? 'repeat(' . $m[1] . ',minmax(' . $low . ',' . nimble_v2_fr($m[3]) . '))' : null;
    }
    return null;
}
function nimble_v2_hex(mixed $value): ?string
{
    if (!is_string($value)) return null;
    $lower = strtolower($value);
    if (nimble_v2_match('hex', $lower)) return $lower;
    return nimble_v2_match('shortHex', $lower) ? '#' . implode('', array_map(static fn($char) => $char . $char, str_split(substr($lower, 1)))) : null;
}
function nimble_v2_color(mixed $value, array $ctx): ?string
{
    if (!is_string($value)) return null;
    if (strtolower($value) === 'transparent') return 'transparent';
    if (nimble_v2_hex($value) !== null) return nimble_v2_hex($value);
    if (str_starts_with($value, '@') && isset($ctx['colors']) && array_key_exists(substr($value, 1), $ctx['colors'])) return $value;
    return null;
}
function nimble_v2_ints(mixed $value, int $count, int $min, int $max): ?array
{
    if (!nimble_v2_is_list($value) || count($value) !== $count) return null;
    foreach ($value as $item) if (!is_int($item) || $item < $min || $item > $max) return null;
    return $value;
}
function nimble_v2_value(string $type, mixed $input, array $ctx): mixed
{
    $parts = explode(':', $type);
    $kind = $parts[0];
    $limits = nimble_v2_spec()['limits'];
    if ($kind === 'enum') return is_string($input) && in_array($input, explode(',', $parts[1]), true) ? $input : null;
    if ($kind === 'bool') return is_bool($input) ? $input : null;
    if ($kind === 'num' || $kind === 'int') {
        if (!nimble_v2_is_number($input) || ($kind === 'int' && !nimble_v2_is_integer($input))) return null;
        if ($input < (float)$parts[1] || $input > (float)$parts[2]) return null;
        return $kind === 'int' ? (int)$input : nimble_v2_round($input);
    }
    if ($kind === 'length') return nimble_v2_length($input);
    if ($kind === 'slength') return nimble_v2_length($input, true);
    if ($kind === 'size') return nimble_v2_length($input, false, true);
    if ($kind === 'box' || $kind === 'margin') {
        if (!nimble_v2_is_list($input) || count($input) !== 4) return null;
        $result = [];
        foreach ($input as $item) {
            $length = $kind === 'margin' ? nimble_v2_length($item, true, true) : nimble_v2_length($item);
            if ($length === null) return null;
            $result[] = $length;
        }
        return $result;
    }
    if ($kind === 'tracks') {
        if (!nimble_v2_is_list($input) || count($input) < 1 || count($input) > $limits['tracks']) return null;
        $result = [];
        foreach ($input as $item) { $track = nimble_v2_track($item); if ($track === null) return null; $result[] = $track; }
        return $result;
    }
    if ($kind === 'cell') return nimble_v2_ints($input, 4, 1, $limits['gridLines']);
    if ($kind === 'color') return nimble_v2_color($input, $ctx);
    if ($kind === 'font') return is_string($input) && isset($ctx['fonts'][$input]) ? $input : null;
    if ($kind === 'background') return nimble_v2_background($input, $ctx);
    if ($kind === 'border') return nimble_v2_border($input, $ctx);
    if ($kind === 'shadows') return nimble_v2_shadows($input, $ctx);
    nimble_error('Unknown specification type ' . $kind . '.');
}
function nimble_v2_background(mixed $input, array $ctx): ?array
{
    if (!nimble_v2_is_object($input)) return null;
    $kind = $input['kind'] ?? null;
    if ($kind === 'color') { $c = nimble_v2_color($input['color'] ?? null, $ctx); return $c !== null ? ['kind' => 'color', 'color' => $c] : null; }
    if ($kind === 'gradient') {
        $type = ($input['type'] ?? null) === 'radial' ? 'radial' : 'linear';
        $angle = array_key_exists('angle', $input) ? nimble_v2_value('num:0:360', $input['angle'], $ctx) : 180;
        $stopsIn = $input['stops'] ?? null;
        if ($angle === null || !nimble_v2_is_list($stopsIn) || count($stopsIn) < 2 || count($stopsIn) > nimble_v2_spec()['limits']['gradientStops']) return null;
        $stops = [];
        foreach ($stopsIn as $stop) {
            if (!nimble_v2_is_object($stop)) return null;
            $c = nimble_v2_color($stop['color'] ?? null, $ctx); $at = nimble_v2_value('num:0:100', $stop['at'] ?? null, $ctx);
            if ($c === null || $at === null) return null;
            $stops[] = ['color' => $c, 'at' => $at];
        }
        return ['kind' => 'gradient', 'type' => $type, 'angle' => $angle, 'stops' => $stops];
    }
    if ($kind === 'image') {
        $src = nimble_v2_safe_url($input['src'] ?? null);
        if ($src === '') return null;
        $result = ['kind' => 'image', 'src' => $src];
        $result['size'] = nimble_v2_value('enum:cover,contain,auto', $input['size'] ?? 'cover', $ctx);
        $result['position'] = nimble_v2_value('enum:center,top,bottom,left,right,top-left,top-right,bottom-left,bottom-right', $input['position'] ?? 'center', $ctx);
        $result['repeat'] = ($input['repeat'] ?? null) === true;
        if ($result['size'] === null || $result['position'] === null) return null;
        foreach (['overlay', 'color'] as $key) {
            if (!array_key_exists($key, $input) || $input[$key] === null) continue;
            $c = nimble_v2_color($input[$key], $ctx);
            if ($c === null) return null;
            $result[$key] = $c;
        }
        return $result;
    }
    return null;
}
function nimble_v2_border(mixed $input, array $ctx): ?array
{
    if (!nimble_v2_is_object($input)) return null;
    $width = nimble_v2_length($input['width'] ?? '1px'); $style = nimble_v2_value('enum:solid,dashed,dotted,double,none', $input['style'] ?? 'solid', $ctx); $c = nimble_v2_color($input['color'] ?? '@line', $ctx);
    if ($width === null || $style === null || $c === null) return null;
    $all = ['top', 'right', 'bottom', 'left'];
    $sides = $input['sides'] ?? $all;
    if (!nimble_v2_is_list($sides) || !$sides) return null;
    foreach ($sides as $side) if (!in_array($side, $all, true)) return null;
    return ['width' => $width, 'style' => $style, 'color' => $c, 'sides' => array_values(array_filter($all, static fn($side) => in_array($side, $sides, true)))];
}
function nimble_v2_shadows(mixed $input, array $ctx): ?array
{
    if (!nimble_v2_is_list($input) || count($input) > nimble_v2_spec()['limits']['shadows']) return null;
    $result = [];
    foreach ($input as $item) {
        if (!nimble_v2_is_object($item)) return null;
        $x = nimble_v2_length($item['x'] ?? '0px', true); $y = nimble_v2_length($item['y'] ?? '0px', true); $blur = nimble_v2_length($item['blur'] ?? '0px'); $spread = nimble_v2_length($item['spread'] ?? '0px', true); $c = nimble_v2_color($item['color'] ?? '#00000033', $ctx);
        if ($x === null || $y === null || $blur === null || $spread === null || $c === null) return null;
        $shadow = ['x' => $x, 'y' => $y, 'blur' => $blur, 'spread' => $spread, 'color' => $c];
        if (($item['inset'] ?? null) === true) $shadow['inset'] = true;
        $result[] = $shadow;
    }
    return $result;
}
function nimble_v2_props(array $schema, mixed $input, array $ctx, string $label): array
{
    $output = [];
    if ($input === null) return $output;
    if (!nimble_v2_is_object($input)) nimble_error($label . ' must be an object.');
    foreach ($schema as $key => $type) {
        if (!nimble_v2_has($input, $key)) continue;
        $result = nimble_v2_value($type, $input[$key], $ctx);
        if ($result === null) nimble_error('Invalid ' . $label . ' value for ' . $key . '.');
        $output[$key] = $result;
    }
    return $output;
}
function nimble_v2_responsive(array $schema, mixed $input, array $ctx, string $label): ?array
{
    if ($input === null) return null;
    if (!nimble_v2_is_object($input)) nimble_error($label . ' must be an object keyed by breakpoint.');
    $output = [];
    foreach ($ctx['bpIds'] as $bp) {
        if (!array_key_exists($bp, $input)) continue;
        $result = nimble_v2_props($schema, $input[$bp], $ctx, $label);
        if ($result) $output[$bp] = $result;
    }
    return $output ?: null;
}
function nimble_v2_link(mixed $input, array $ctx): ?array
{
    if (!nimble_v2_is_object($input)) return null;
    $to = $input['to'] ?? null; $result = null;
    if ($to === 'page' && is_string($input['page'] ?? null) && isset($ctx['pageIds'][$input['page']])) {
        $result = ['to' => 'page', 'page' => $input['page']];
        if (is_string($input['anchor'] ?? null) && isset($ctx['nodeIds'][$input['anchor']])) $result['anchor'] = $input['anchor'];
    }
    if ($to === 'anchor' && is_string($input['node'] ?? null) && isset($ctx['nodeIds'][$input['node']])) $result = ['to' => 'anchor', 'node' => $input['node']];
    if (($to === 'url' || $to === 'asset') && nimble_v2_safe_url($input['href'] ?? null) !== '') $result = ['to' => $to, 'href' => nimble_v2_safe_url($input['href'])];
    if ($to === 'email' && nimble_v2_match('email', $input['address'] ?? null)) $result = ['to' => 'email', 'address' => $input['address']];
    if ($to === 'phone' && nimble_v2_match('phone', $input['number'] ?? null)) $result = ['to' => 'phone', 'number' => $input['number']];
    if ($result !== null && ($input['newTab'] ?? null) === true) $result['newTab'] = true;
    return $result;
}
function nimble_v2_runs(mixed $input, array $ctx, array &$budget): array
{
    $limits = nimble_v2_spec()['limits'];
    if (!nimble_v2_is_list($input)) nimble_error('Rich text content must be a list of text runs.');
    $output = [];
    foreach ($input as $run) {
        if (!nimble_v2_is_object($run)) nimble_error('Rich text runs must be objects.');
        if (--$budget['runs'] < 0) nimble_error('Rich text has too many runs.');
        $item = ['text' => nimble_v2_text($run['text'] ?? '', $limits['textChars'], 'Rich text')];
        $budget['chars'] -= nimble_v2_chars($item['text']);
        if ($budget['chars'] < 0) nimble_error('Rich text must be at most ' . $limits['textChars'] . ' characters.');
        foreach (['b', 'i', 'u', 's'] as $mark) if (($run[$mark] ?? null) === true) $item[$mark] = true;
        if (array_key_exists('color', $run) && $run['color'] !== null) { $c = nimble_v2_color($run['color'], $ctx); if ($c === null) nimble_error('Invalid rich text colour.'); $item['color'] = $c; }
        if (array_key_exists('link', $run) && $run['link'] !== null) { $l = nimble_v2_link($run['link'], $ctx); if ($l !== null) $item['link'] = $l; }
        if (in_array($run['token'] ?? null, ['year', 'siteName'], true)) { $item['token'] = $run['token']; $item['text'] = ''; }
        $output[] = $item;
    }
    return $output;
}
function nimble_v2_rich_text(mixed $input, array $ctx): array
{
    $spec = nimble_v2_spec(); $limits = $spec['limits'];
    if ($input === null) return [];
    if (!nimble_v2_is_list($input) || count($input) > $limits['richBlocks']) nimble_error('Rich text must be a list of at most ' . $limits['richBlocks'] . ' blocks.');
    $budget = ['runs' => $limits['richRuns'], 'chars' => $limits['textChars']];
    $output = [];
    foreach ($input as $block) {
        if (!nimble_v2_is_object($block) || !in_array($block['t'] ?? null, $spec['richBlockTags'], true)) nimble_error('Rich text blocks need a valid tag.');
        $item = ['t' => $block['t']];
        if (array_key_exists('style', $block) && $block['style'] !== null) {
            if (!in_array($block['style'], $spec['textStyleKeys'], true)) nimble_error('Unknown text style.');
            $item['style'] = $block['style'];
        }
        if (array_key_exists('align', $block) && $block['align'] !== null) {
            if (!in_array($block['align'], ['left', 'center', 'right', 'justify'], true)) nimble_error('Invalid text alignment.');
            $item['align'] = $block['align'];
        }
        if ($block['t'] === 'ul' || $block['t'] === 'ol') {
            $items = $block['items'] ?? null;
            if (!nimble_v2_is_list($items) || count($items) > $limits['listItems']) nimble_error('Lists need at most ' . $limits['listItems'] . ' items.');
            $item['items'] = [];
            foreach ($items as $runs) $item['items'][] = nimble_v2_runs($runs, $ctx, $budget);
        } else $item['c'] = nimble_v2_runs($block['c'] ?? [], $ctx, $budget);
        $output[] = $item;
    }
    return $output;
}
function nimble_v2_node_props(string $type, mixed $input, array $ctx): array
{
    $spec = nimble_v2_spec();
    $schema = $spec['nodeTypes'][$type]['props'] ?? [];
    $output = [];
    if ($input === null) return $output;
    if (!nimble_v2_is_object($input)) nimble_error('Element properties must be an object.');
    foreach ($schema as $key => $kind) {
        if (!nimble_v2_has($input, $key)) continue;
        $source = $input[$key];
        if ($kind === 'richtext') $result = nimble_v2_rich_text($source, $ctx);
        elseif (str_starts_with($kind, 'text:')) $result = nimble_v2_text($source, (int)substr($kind, 5), $key);
        elseif ($kind === 'media') { if ($source === '') continue; $result = nimble_v2_safe_url($source); if ($result === '') nimble_error('Use a valid HTTP(S) URL or local path for ' . $key . '.'); }
        elseif ($kind === 'video') { if ($source === '') continue; if (!nimble_v2_video_source($source)) nimble_error('Videos must be MP4/WebM files or YouTube/Vimeo URLs.'); $result = nimble_v2_safe_url($source); }
        elseif ($kind === 'mediaList') {
            if (!nimble_v2_is_list($source) || count($source) > $spec['limits']['galleryImages']) nimble_error('Use no more than ' . $spec['limits']['galleryImages'] . ' gallery images.');
            $result = [];
            foreach ($source as $item) { $url = nimble_v2_safe_url($item); if ($url === '') nimble_error('Gallery images need valid URLs.'); $result[] = $url; }
        } elseif ($kind === 'link') { $result = nimble_v2_link($source, $ctx); if ($result === null) continue; }
        else { $result = nimble_v2_value($kind, $source, $ctx); if ($result === null) nimble_error('Invalid element property ' . $key . '.'); }
        $output[$key] = $result;
    }
    return $output;
}
function nimble_v2_node(string $id, array $source, array $info, array $ctx): array
{
    $spec = nimble_v2_spec();
    $type = $source['type']; $definition = $spec['nodeTypes'][$type];
    $node = ['id' => $id, 'type' => $type];
    if (array_key_exists('name', $source) && $source['name'] !== null && $source['name'] !== '') $node['name'] = nimble_v2_text($source['name'], 80, 'Element name');
    if (array_key_exists('tag', $source) && $source['tag'] !== null) {
        if (!isset($definition['tags']) || !in_array($source['tag'], $definition['tags'], true)) nimble_error('Invalid HTML tag for ' . $type . '.');
        $node['tag'] = $source['tag'];
    }
    $content = nimble_v2_node_props($type, $source['props'] ?? null, $ctx);
    if ($content) $node['props'] = $content;
    if (!empty($definition['container'])) $node['children'] = $info['children'];
    $layout = !empty($definition['container']) ? nimble_v2_responsive($spec['layout'], $source['layout'] ?? null, $ctx, 'layout') : null;
    if ($layout !== null) $node['layout'] = $layout;
    $place = $info['root'] ? null : nimble_v2_responsive($spec['place'], $source['place'] ?? null, $ctx, 'placement');
    if ($place !== null) $node['place'] = $place;
    $style = nimble_v2_responsive($spec['style'], $source['style'] ?? null, $ctx, 'style');
    if ($style !== null) $node['style'] = $style;
    if (array_key_exists('hidden', $source) && $source['hidden'] !== null) {
        if (!nimble_v2_is_object($source['hidden'])) nimble_error('Hidden must be an object keyed by breakpoint.');
        $hidden = [];
        foreach ($ctx['bpIds'] as $bp) if (is_bool($source['hidden'][$bp] ?? null) && !($bp === 'desktop' && !$source['hidden'][$bp])) $hidden[$bp] = $source['hidden'][$bp];
        if ($hidden) $node['hidden'] = $hidden;
    }
    if (($source['locked'] ?? null) === true) $node['locked'] = true;
    return $node;
}
function nimble_v2_design(mixed $input, array &$ctx): array
{
    $spec = nimble_v2_spec(); $limits = $spec['limits'];
    $design = nimble_v2_is_object($input) ? $input : [];
    $colors = [];
    if (array_key_exists('colors', $design) && $design['colors'] !== null) {
        if (!nimble_v2_is_object($design['colors']) || count($design['colors']) > $limits['colors']) nimble_error('Use no more than ' . $limits['colors'] . ' theme colours.');
        foreach ($design['colors'] as $key => $hex) {
            if (!nimble_v2_match('key', (string)$key) || nimble_v2_hex($hex) === null) nimble_error('Theme colours need a short lowercase name and a hex value.');
            $colors[(string)$key] = nimble_v2_hex($hex);
        }
    }
    foreach ($spec['defaultColors'] as $key => $hex) if (!array_key_exists($key, $colors)) $colors[$key] = $hex;
    $ctx['colors'] = $colors;
    $fonts = []; $fontIds = [];
    $sourceFonts = array_key_exists('fonts', $design) ? $design['fonts'] : $spec['defaultFonts'];
    if (!nimble_v2_is_list($sourceFonts) || count($sourceFonts) > $limits['fonts']) nimble_error('Use no more than ' . $limits['fonts'] . ' fonts.');
    foreach ($sourceFonts as $font) {
        if (!nimble_v2_is_object($font) || !is_string($font['id'] ?? null) || !nimble_v2_match('key', $font['id']) || isset($fontIds[$font['id']])) nimble_error('Fonts need unique short lowercase IDs.');
        $source = $font['source'] ?? null; $family = $font['family'] ?? null;
        if ($source === 'system' && is_string($family) && array_key_exists($family, $spec['systemFonts'])) $fonts[] = ['id' => $font['id'], 'source' => 'system', 'family' => $family];
        elseif ($source === 'custom' && nimble_v2_match('fontFamily', $family) && nimble_v2_match('fontFile', $font['src'] ?? null)) $fonts[] = ['id' => $font['id'], 'source' => 'custom', 'family' => $family, 'src' => $font['src']];
        else nimble_error('Fonts must be a system font or an uploaded font file.');
        $fontIds[$font['id']] = true;
    }
    foreach ($spec['defaultFonts'] as $font) if (!isset($fontIds[$font['id']])) { $fonts[] = $font; $fontIds[$font['id']] = true; }
    $ctx['fonts'] = $fontIds;
    $textStyles = [];
    $sourceStyles = nimble_v2_is_object($design['textStyles'] ?? null) ? $design['textStyles'] : [];
    foreach ($spec['textStyleKeys'] as $key) {
        $value = array_key_exists($key, $sourceStyles) ? nimble_v2_responsive($spec['textStyle'], $sourceStyles[$key], $ctx, 'text style') : null;
        $textStyles[$key] = $value ?? nimble_v2_responsive($spec['textStyle'], $spec['defaultTextStyles'][$key], $ctx, 'text style');
    }
    $result = ['colors' => $colors, 'fonts' => $fonts, 'textStyles' => $textStyles];
    $body = nimble_v2_props(['font' => 'font', 'color' => 'color', 'background' => 'color'], array_key_exists('body', $design) ? $design['body'] : ['font' => 'body', 'color' => '@ink', 'background' => '@bg'], $ctx, 'body style');
    if ($body) $result['body'] = $body;
    return $result;
}
function nimble_v2_breakpoints(mixed $input): array
{
    $spec = nimble_v2_spec();
    $source = $input ?? $spec['defaultBreakpoints'];
    if (!nimble_v2_is_list($source) || count($source) > $spec['limits']['breakpoints']) nimble_error('Use no more than ' . $spec['limits']['breakpoints'] . ' breakpoints.');
    $ids = ['desktop' => true]; $output = [];
    foreach ($source as $bp) {
        if (!nimble_v2_is_object($bp) || !is_string($bp['id'] ?? null) || !nimble_v2_match('key', $bp['id']) || isset($ids[$bp['id']])) nimble_error('Breakpoints need unique short lowercase IDs.');
        $max = $bp['max'] ?? null;
        if (!is_int($max) || $max < $spec['breakpointRange'][0] || $max > $spec['breakpointRange'][1]) nimble_error('Breakpoint widths must be ' . implode('–', $spec['breakpointRange']) . ' pixels.');
        $ids[$bp['id']] = true;
        $name = nimble_v2_text($bp['name'] ?? $bp['id'], 40, 'Breakpoint name');
        $output[] = ['id' => $bp['id'], 'name' => $name !== '' ? $name : $bp['id'], 'max' => $max];
    }
    usort($output, static fn($a, $b) => $b['max'] <=> $a['max']);
    if (count(array_unique(array_column($output, 'max'))) !== count($output)) nimble_error('Breakpoints need different widths.');
    return $output;
}
function nimble_v2_normalize(array $input): array
{
    $spec = nimble_v2_spec(); $limits = $spec['limits'];
    if (($input['version'] ?? null) !== 2 || !nimble_v2_is_object($input['site'] ?? null) || !nimble_v2_is_list($input['pages'] ?? null) || !nimble_v2_is_object($input['nodes'] ?? null)) nimble_error('A v2 site needs metadata, pages, and an element map.');
    if (count($input['pages']) < 1 || count($input['pages']) > $limits['pages']) nimble_error('Use 1–' . $limits['pages'] . ' pages.');
    if (count($input['nodes']) > $limits['nodes']) nimble_error('Use no more than ' . $limits['nodes'] . ' elements.');
    $settings = $input['site'];
    $name = trim(nimble_v2_text($settings['name'] ?? null, 120, 'Site name'));
    if ($name === '' && !array_key_exists('name', $settings)) $name = 'Nimble';
    if ($name === '') nimble_error('Site name is required.');
    $domain = trim(nimble_v2_text($settings['domain'] ?? null, 253, 'Domain'));
    if ($domain !== '' && !nimble_v2_match('domain', $domain)) nimble_error('Enter a hostname without a protocol or path.');
    $lang = array_key_exists('lang', $settings) ? $settings['lang'] : 'en';
    if (!is_string($lang) || !nimble_v2_match('lang', $lang)) nimble_error('Enter a valid language code such as en or nb-NO.');
    $socialImage = '';
    if (isset($settings['socialImage']) && $settings['socialImage'] !== '') { $socialImage = nimble_v2_safe_url(nimble_v2_text($settings['socialImage'], 3000)); if ($socialImage === '') nimble_error('Use a valid HTTP(S) URL or local path for the social image.'); }
    $site = ['name' => $name, 'domain' => $domain, 'description' => nimble_v2_text($settings['description'] ?? null, 2000, 'Description'), 'lang' => $lang, 'searchVisible' => ($settings['searchVisible'] ?? null) !== false, 'socialImage' => $socialImage];

    $breakpoints = nimble_v2_breakpoints($input['breakpoints'] ?? null);
    $ctx = ['bpIds' => array_merge(['desktop'], array_column($breakpoints, 'id'))];
    $design = nimble_v2_design($input['design'] ?? null, $ctx);

    $assetsIn = $input['assets'] ?? [];
    if (!nimble_v2_is_list($assetsIn) || count($assetsIn) > $limits['assets']) nimble_error('Use no more than ' . $limits['assets'] . ' media assets.');
    $assets = []; $assetIds = [];
    foreach ($assetsIn as $asset) {
        if (!nimble_v2_is_object($asset) || !is_string($asset['id'] ?? null) || !nimble_v2_match('id', $asset['id']) || isset($assetIds[$asset['id']]) || !in_array($asset['kind'] ?? null, ['image', 'video'], true)) nimble_error('Each media asset needs a unique valid ID and media type.');
        $assetIds[$asset['id']] = true;
        $url = nimble_v2_safe_url(nimble_v2_text($asset['url'] ?? null, 3000, 'Media URL'));
        if ($url === '') nimble_error('Media assets need a valid URL.');
        $assetName = nimble_v2_text($asset['name'] ?? null, 200, 'Media name');
        $assets[] = ['id' => $asset['id'], 'name' => $assetName !== '' ? $assetName : 'Media', 'kind' => $asset['kind'], 'url' => $url];
    }

    $pageIds = []; $paths = []; $pages = [];
    foreach ($input['pages'] as $item) {
        if (!nimble_v2_is_object($item) || !is_string($item['id'] ?? null) || !nimble_v2_match('pageId', $item['id']) || isset($pageIds[$item['id']])) nimble_error('Pages need unique lowercase IDs.');
        $pageIds[$item['id']] = true;
        $path = $item['id'] === 'home' ? '/' : (array_key_exists('path', $item) ? nimble_v2_text($item['path'], 200, 'Page address') : '/' . $item['id']);
        if (!nimble_v2_match('pagePath', $path) || isset($paths[$path]) || nimble_v2_match('reservedPath', $path)) nimble_error('Choose a unique page address outside reserved application paths.');
        $paths[$path] = true;
        $pageName = trim(nimble_v2_text($item['name'] ?? null, 120, 'Page name'));
        if ($pageName === '') nimble_error('Every page needs a name.');
        if (!nimble_v2_is_list($item['children'] ?? null) || count($item['children']) > $limits['children']) nimble_error('Pages need a list of at most ' . $limits['children'] . ' sections.');
        $page = ['id' => $item['id'], 'name' => $pageName, 'path' => $path, 'children' => $item['children']];
        foreach (['title', 'description'] as $key) if (isset($item[$key]) && $item[$key] !== '') $page[$key] = nimble_v2_text($item[$key], $key === 'title' ? 200 : 2000, 'Page ' . $key);
        $page['showHeader'] = ($item['showHeader'] ?? null) !== false;
        $page['showFooter'] = ($item['showFooter'] ?? null) !== false;
        $pages[] = $page;
    }
    if (!isset($pageIds['home'])) nimble_error('The site needs a home page.');

    $infos = [];
    $nodesIn = $input['nodes'];
    $visit = static function (mixed $id, int $depth, bool $root) use (&$visit, &$infos, $nodesIn, $spec, $limits): void {
        if (!is_string($id) || !nimble_v2_match('id', $id) || !array_key_exists($id, $nodesIn)) nimble_error('An element reference is missing or invalid.');
        if (isset($infos[$id])) nimble_error('An element can only appear once in the site.');
        $source = $nodesIn[$id];
        if (!nimble_v2_is_object($source) || !is_string($source['type'] ?? null) || !array_key_exists($source['type'], $spec['nodeTypes'])) nimble_error('An element has an invalid type.');
        $definition = $spec['nodeTypes'][$source['type']];
        if ($root !== !empty($definition['root'])) nimble_error($root ? 'Pages, headers and footers may only contain sections.' : 'Sections can only be placed directly on a page.');
        if ($depth > $limits['depth']) nimble_error('Elements can be nested at most ' . $limits['depth'] . ' levels deep.');
        $infos[$id] = ['root' => $root, 'children' => []];
        if (!empty($definition['container'])) {
            $children = array_key_exists('children', $source) ? $source['children'] : [];
            if (!nimble_v2_is_list($children) || count($children) > $limits['children']) nimble_error('Containers can hold at most ' . $limits['children'] . ' elements.');
            $infos[$id]['children'] = $children;
            foreach ($children as $child) $visit($child, $depth + 1, false);
        }
    };
    $header = $input['header'] ?? null; $footer = $input['footer'] ?? null;
    if ($header !== null) $visit($header, 1, true);
    if ($footer !== null) $visit($footer, 1, true);
    foreach ($pages as $page) foreach ($page['children'] as $id) $visit($id, 1, true);
    $ctx['pageIds'] = $pageIds;
    $ctx['nodeIds'] = array_fill_keys(array_keys($infos), true);
    $nodes = [];
    foreach ($infos as $id => $info) $nodes[(string)$id] = nimble_v2_node((string)$id, $nodesIn[$id], $info, $ctx);

    $output = ['version' => 2, 'site' => $site, 'design' => $design, 'breakpoints' => $breakpoints, 'assets' => $assets];
    if ($header !== null) $output['header'] = $header;
    if ($footer !== null) $output['footer'] = $footer;
    $output['pages'] = $pages;
    // An empty PHP array would encode as [] — the element map must stay a JSON object.
    $output['nodes'] = $nodes ?: new ArrayObject();
    return $output;
}
function nimble_v2_page_href(array $site, string $pageId): string
{
    foreach ($site['pages'] as $page) if ($page['id'] === $pageId) return $page['id'] === 'home' ? './' : './' . $page['id'] . '.html';
    return '#';
}
function nimble_has_form(?array $site, string $id): bool
{
    if (!$site) return false;
    if (($site['version'] ?? null) === 2) return isset($site['nodes'][$id]) && $site['nodes'][$id]['type'] === 'form';
    foreach ($site['pages'] ?? [] as $page) if (in_array($id, $page['blocks'] ?? [], true)) return ($site['blocks'][$id]['type'] ?? null) === 'form';
    return false;
}
