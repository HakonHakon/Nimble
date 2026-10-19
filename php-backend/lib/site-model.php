<?php
declare(strict_types=1);

const PARSEN_BLOCK_TYPES = ['hero', 'services', 'split', 'video', 'cta', 'text', 'image', 'button', 'gallery', 'columns', 'quote', 'form'];
const PARSEN_THEMES = ['purple' => '#6957ff', 'orange' => '#df754e', 'mint' => '#3b9c7a', 'dark' => '#4c4a92', 'lemon' => '#b38f19'];
const PARSEN_FONTS = ['sans' => 'Inter, system-ui, sans-serif', 'serif' => 'Georgia, serif', 'mono' => 'ui-monospace, monospace'];

class ParsenHttpException extends RuntimeException {}

function parsen_error(string $message, int $status = 400): never
{
    throw new ParsenHttpException($message, $status);
}

function parsen_escape(mixed $value): string
{
    return htmlspecialchars((string)($value ?? ''), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

function parsen_text(mixed $value, string $fallback = '', int $limit = 10000): string
{
    if ($value === null) return $fallback;
    if (!is_string($value) || strlen($value) > $limit) parsen_error('Text fields must be strings of at most ' . $limit . ' characters.');
    return str_replace("\0", '', $value);
}

function parsen_safe_url(mixed $value, bool $links = false, bool $data = false): string
{
    if (!is_string($value) || strlen($value) > 3000 || preg_match('/[\x00-\x20\x7f\\<>"\']/', $value)) return '';
    if (str_starts_with($value, '/') && !str_starts_with($value, '//')) return $value;
    if ($links && preg_match('/^#[a-z0-9_-]*$/i', $value)) return $value;
    if ($links && preg_match('/^(mailto:[^\s@]+@[^\s@]+|tel:\+?[0-9()\-]+)$/i', $value)) return $value;
    if ($data && preg_match('#^data:image/(png|jpeg|webp|gif);base64,[a-z0-9+/=]+$#i', $value)) return $value;
    $parts = parse_url($value);
    if (!$parts || !in_array(strtolower((string)($parts['scheme'] ?? '')), ['http', 'https'], true)) return '';
    if (isset($parts['user']) || isset($parts['pass'])) return '';
    return $value;
}

function parsen_url_field(mixed $value, bool $links = false): string
{
    if (!$value) return '';
    $result = parsen_safe_url(parsen_text($value, '', 3000), $links);
    if (!$result) parsen_error('Use a valid HTTP(S) URL, local path, email link, or telephone link.');
    return $result;
}

function parsen_video_source(mixed $value): ?array
{
    $candidate = parsen_safe_url($value);
    if (!$candidate) return null;
    if (str_starts_with($candidate, '/uploads/') || preg_match('/\.(mp4|webm)(?:[?#]|$)/i', $candidate)) return ['kind' => 'file', 'url' => $candidate];
    $parts = parse_url($candidate);
    if (!$parts) return null;
    $host = strtolower(preg_replace('/^www\./', '', (string)($parts['host'] ?? '')));
    $id = null;
    if ($host === 'youtu.be') $id = trim((string)($parts['path'] ?? ''), '/');
    if (in_array($host, ['youtube.com', 'm.youtube.com', 'youtube-nocookie.com'], true)) {
        parse_str((string)($parts['query'] ?? ''), $query);
        $id = $query['v'] ?? (preg_match('#^/(?:embed|shorts)/([^/]+)#', (string)($parts['path'] ?? ''), $match) ? $match[1] : null);
    }
    if ($id !== null && preg_match('/^[a-z0-9_-]{6,24}$/i', $id)) return ['kind' => 'embed', 'url' => 'https://www.youtube-nocookie.com/embed/' . $id];
    if (in_array($host, ['vimeo.com', 'player.vimeo.com'], true) && preg_match('#(?:^|/)([0-9]{3,15})$#', (string)($parts['path'] ?? ''), $match)) return ['kind' => 'embed', 'url' => 'https://player.vimeo.com/video/' . $match[1]];
    return null;
}

function parsen_block_id(string $id): bool
{
    return (bool)preg_match('/^[a-z][a-z0-9_-]{0,79}$/', $id);
}

function parsen_normalize(array $input): array
{
    if (!isset($input['site'], $input['pages'], $input['blocks']) || !is_array($input['site']) || !is_array($input['pages']) || !is_array($input['blocks'])) parsen_error('A site needs metadata, a page list, and a block map.');
    if (count($input['pages']) < 1 || count($input['pages']) > 100 || count($input['blocks']) > 2000) parsen_error('Use 1–100 pages and no more than 2,000 blocks.');
    $settings = $input['site'];
    $name = trim(parsen_text($settings['name'] ?? null, 'Nimble', 120));
    if ($name === '') parsen_error('Site name is required.');
    $domain = trim(parsen_text($settings['domain'] ?? null, '', 253));
    if ($domain !== '' && !preg_match('/^(localhost|[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::[0-9]{1,5})?$/i', $domain)) parsen_error('Enter a hostname without a protocol or path.');
    $output = [
        'version' => 1,
        'site' => [
            'name' => $name,
            'domain' => $domain,
            'description' => parsen_text($settings['description'] ?? null, '', 2000),
            'searchVisible' => ($settings['searchVisible'] ?? true) !== false,
            'socialImage' => parsen_url_field($settings['socialImage'] ?? null),
            'headingFont' => array_key_exists($settings['headingFont'] ?? '', PARSEN_FONTS) ? $settings['headingFont'] : 'sans',
            'bodyFont' => array_key_exists($settings['bodyFont'] ?? '', PARSEN_FONTS) ? $settings['bodyFont'] : 'sans',
            'rounded' => ($settings['rounded'] ?? true) !== false,
        ],
        'theme' => array_key_exists($input['theme'] ?? '', PARSEN_THEMES) ? $input['theme'] : 'purple',
        'assets' => [], 'pages' => [], 'blocks' => [],
    ];
    if (isset($input['assets']) && (!is_array($input['assets']) || count($input['assets']) > 500)) parsen_error('Use no more than 500 media assets.');
    $assetIds = [];
    foreach (($input['assets'] ?? []) as $asset) {
        if (!is_array($asset) || !parsen_block_id((string)($asset['id'] ?? '')) || isset($assetIds[$asset['id']]) || !in_array($asset['kind'] ?? '', ['image', 'video'], true)) parsen_error('Each media asset needs a unique valid ID and media type.');
        $assetIds[$asset['id']] = true;
        $output['assets'][] = ['id' => $asset['id'], 'name' => parsen_text($asset['name'] ?? null, 'Media', 200), 'kind' => $asset['kind'], 'url' => parsen_url_field($asset['url'] ?? null)];
    }
    foreach ($input['blocks'] as $id => $source) {
        if (!parsen_block_id((string)$id) || !is_array($source) || !in_array($source['type'] ?? '', PARSEN_BLOCK_TYPES, true)) parsen_error('A block has an invalid ID or type.');
        $block = ['id' => (string)$id, 'type' => $source['type']];
        foreach (['title', 'eyebrow', 'text', 'button', 'label', 'alt', 'author'] as $field) {
            if (array_key_exists($field, $source)) $block[$field] = parsen_text($source[$field], '', $field === 'text' ? 20000 : 1000);
        }
        foreach (['image', 'videoUrl'] as $field) if (!empty($source[$field])) $block[$field] = parsen_url_field($source[$field]);
        if (!empty($source['videoUrl']) && parsen_video_source($source['videoUrl']) === null) parsen_error('Videos must be MP4/WebM files or YouTube/Vimeo URLs.');
        if (!empty($source['buttonLink'])) $block['buttonLink'] = parsen_url_field($source['buttonLink'], true);
        if (!empty($source['bg'])) {
            if (!preg_match('/^#[0-9a-f]{6}$/i', (string)$source['bg'])) parsen_error('Choose a valid background colour.');
            $block['bg'] = $source['bg'];
        }
        if (array_key_exists('cards', $source)) {
            if (!is_array($source['cards']) || count($source['cards']) > 12) parsen_error('Cards need a heading and description.');
            $block['cards'] = [];
            foreach ($source['cards'] as $card) {
                if (!is_array($card) || count($card) !== 2) parsen_error('Cards need a heading and description.');
                $block['cards'][] = [parsen_text($card[0], '', 500), parsen_text($card[1], '', 3000)];
            }
        }
        if (array_key_exists('images', $source)) {
            if (!is_array($source['images']) || count($source['images']) > 24) parsen_error('Use no more than 24 gallery images.');
            $block['images'] = array_map(fn($value) => parsen_url_field($value), $source['images']);
        }
        $output['blocks'][$id] = $block;
    }
    $ids = []; $paths = []; $used = [];
    foreach ($input['pages'] as $item) {
        if (!is_array($item) || !preg_match('/^[a-z][a-z0-9-]{0,63}$/', (string)($item['id'] ?? '')) || isset($ids[$item['id']])) parsen_error('Pages need unique lowercase IDs.');
        $id = $item['id']; $ids[$id] = true;
        $pagePath = $id === 'home' ? '/' : parsen_text($item['path'] ?? null, '/' . $id, 200);
        if (!preg_match('#^/(?:[a-z0-9-]+(?:/[a-z0-9-]+)*)?$#', $pagePath) || isset($paths[$pagePath]) || preg_match('#^/(?:api|assets|uploads|published|builder|control-panel|login)(?:/|$)#', $pagePath)) parsen_error('Choose a unique page address outside reserved application paths.');
        $paths[$pagePath] = true;
        if (!isset($item['blocks']) || !is_array($item['blocks']) || count($item['blocks']) > 200 || count(array_unique($item['blocks'])) !== count($item['blocks'])) parsen_error('Pages must reference existing blocks without duplicates.');
        $pageBlocks = [];
        foreach ($item['blocks'] as $blockId) {
            if (!isset($output['blocks'][$blockId])) parsen_error('Pages must reference existing blocks without duplicates.');
            $reference = $blockId;
            if (isset($used[$blockId])) {
                $reference = substr($id . '_' . $blockId, 0, 76); $suffix = 1;
                while (isset($output['blocks'][$reference])) $reference = substr($id . '_' . $blockId, 0, 72) . '_' . (++$suffix);
                $output['blocks'][$reference] = $output['blocks'][$blockId]; $output['blocks'][$reference]['id'] = $reference;
            }
            $used[$reference] = true; $pageBlocks[] = $reference;
        }
        $pageName = trim(parsen_text($item['name'] ?? null, '', 120));
        if ($pageName === '') parsen_error('Every page needs a name.');
        $output['pages'][] = ['id' => $id, 'name' => $pageName, 'path' => $pagePath, 'blocks' => $pageBlocks];
    }
    if (!isset($ids['home'])) parsen_error('The site needs a home page.');
    $usedBlocks = [];
    foreach (array_keys($used) as $id) $usedBlocks[$id] = $output['blocks'][$id];
    $output['blocks'] = $usedBlocks;
    return $output;
}

function parsen_default_site(): array
{
    return parsen_normalize([
        'site' => ['name' => 'Nimble', 'description' => 'Build a clear, useful website with ease.'], 'theme' => 'purple', 'assets' => [],
        'pages' => [['id' => 'home', 'name' => 'Home', 'path' => '/', 'blocks' => ['hero', 'services', 'contact']]],
        'blocks' => [
            'hero' => ['type' => 'hero', 'eyebrow' => 'NIMBLE WEBSITE BUILDER', 'title' => 'Make good things happen.', 'text' => 'Start with a clear idea, shape it visually, and publish when it feels right.', 'button' => 'Get in touch', 'buttonLink' => '#contact'],
            'services' => ['type' => 'services', 'title' => 'Built around you.', 'text' => 'Design, craftsmanship, and advice.', 'cards' => [['Design', 'Clear ideas, carefully developed.'], ['Build', 'Practical work, beautifully finished.'], ['Advice', 'A second pair of eyes for the important decisions.']]],
            'contact' => ['type' => 'form', 'title' => 'Let’s talk', 'text' => 'Tell us about your project.'],
        ],
    ]);
}

function parsen_page_link(array $site, mixed $value): string
{
    foreach ($site['pages'] as $page) if ($page['id'] === $value || $page['path'] === $value) return $page['id'] === 'home' ? './' : './' . $page['id'] . '.html';
    return parsen_safe_url($value, true) ?: '#';
}
