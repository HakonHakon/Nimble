<?php
declare(strict_types=1);
// 1:1 port of lib/render-v2.mjs — keep both in sync (test/v2-parity.test.mjs).
require_once __DIR__ . '/site-model-v2.php';

const NIMBLE_V2_RESET = ['grid-area' => 'auto', 'justify-self' => 'auto', 'align-self' => 'auto', 'order' => '0', 'transform' => 'none', 'z-index' => 'auto', 'grid-template-columns' => 'none', 'grid-template-rows' => 'none', 'flex-direction' => 'row', 'flex-wrap' => 'nowrap', 'justify-content' => 'normal', 'justify-items' => 'normal', 'align-items' => 'normal', 'row-gap' => 'normal', 'column-gap' => 'normal', 'margin' => '0', 'padding' => '0', 'min-height' => 'auto', 'width' => 'auto', 'height' => 'auto', 'min-width' => 'auto', 'max-width' => 'none', 'max-height' => 'none'];
const NIMBLE_V2_FLEX = ['start' => 'flex-start', 'end' => 'flex-end', 'center' => 'center', 'stretch' => 'stretch', 'baseline' => 'baseline', 'space-between' => 'space-between', 'space-around' => 'space-around', 'space-evenly' => 'space-evenly'];
const NIMBLE_V2_SIDES = ['top', 'right', 'bottom', 'left'];

function nimble_v2_e(mixed $value): string { return strtr((string)($value ?? ''), ['&' => '&amp;', '<' => '&lt;', '>' => '&gt;', '"' => '&quot;', "'" => '&#39;']); }
function nimble_v2_color_value(string $value): string { return str_starts_with($value, '@') ? 'var(--c-' . substr($value, 1) . ')' : $value; }
function nimble_v2_bp_ids(array $site): array { return array_merge(['desktop'], array_column($site['breakpoints'], 'id')); }
function nimble_v2_cascade(?array $map, array $ids, int $index): array
{
    $result = [];
    if (!$map) return $result;
    for ($i = 0; $i <= $index; $i++) if (isset($map[$ids[$i]])) $result = array_merge($result, $map[$ids[$i]]);
    return $result;
}
function nimble_v2_hidden_at(array $node, array $ids, int $index): bool
{
    $hidden = false;
    if (isset($node['hidden'])) for ($i = 0; $i <= $index; $i++) if (is_bool($node['hidden'][$ids[$i]] ?? null)) $hidden = $node['hidden'][$ids[$i]];
    return $hidden;
}
function nimble_v2_size_value(string $value, bool $max = false): string { return $value === 'auto' && $max ? 'none' : $value; }
function nimble_v2_background_css(array $value): string
{
    if ($value['kind'] === 'color') return nimble_v2_color_value($value['color']);
    if ($value['kind'] === 'gradient') {
        $stops = implode(',', array_map(static fn($stop) => nimble_v2_color_value($stop['color']) . ' ' . nimble_v2_num_string($stop['at']) . '%', $value['stops']));
        return $value['type'] === 'radial' ? 'radial-gradient(circle,' . $stops . ')' : 'linear-gradient(' . nimble_v2_num_string($value['angle']) . 'deg,' . $stops . ')';
    }
    $overlay = isset($value['overlay']) ? 'linear-gradient(' . nimble_v2_color_value($value['overlay']) . ',' . nimble_v2_color_value($value['overlay']) . '),' : '';
    return $overlay . 'url("' . $value['src'] . '") ' . preg_replace('/-/', ' ', $value['position'], 1) . '/' . $value['size'] . ' ' . ($value['repeat'] ? 'repeat' : 'no-repeat') . (isset($value['color']) ? ' ' . nimble_v2_color_value($value['color']) : '');
}
function nimble_v2_typography(array &$rules, string $selector, array $style): void
{
    if (isset($style['color'])) $rules[$selector]['color'] = nimble_v2_color_value($style['color']);
    if (isset($style['font'])) $rules[$selector]['font-family'] = 'var(--f-' . $style['font'] . ')';
    if (isset($style['fontSize'])) $rules[$selector]['font-size'] = $style['fontSize'];
    if (isset($style['fontWeight'])) $rules[$selector]['font-weight'] = nimble_v2_num_string($style['fontWeight']);
    if (isset($style['lineHeight'])) $rules[$selector]['line-height'] = nimble_v2_num_string($style['lineHeight']);
    if (isset($style['letterSpacing'])) $rules[$selector]['letter-spacing'] = $style['letterSpacing'];
    if (isset($style['textAlign'])) $rules[$selector]['text-align'] = $style['textAlign'];
    if (isset($style['textTransform'])) $rules[$selector]['text-transform'] = $style['textTransform'];
}
function nimble_v2_node_rules(array &$rules, array $site, array $node, ?array $parentLayout, array $ids, int $index): void
{
    $spec = nimble_v2_spec();
    $selector = '.n-' . $node['id']; $definition = $spec['nodeTypes'][$node['type']];
    $layout = nimble_v2_cascade($node['layout'] ?? null, $ids, $index); $place = nimble_v2_cascade($node['place'] ?? null, $ids, $index); $style = nimble_v2_cascade($node['style'] ?? null, $ids, $index);
    $container = !empty($definition['container']);
    $display = $definition['display'];
    if ($container) $display = ($layout['mode'] ?? null) === 'stack' ? 'flex' : 'grid';
    $rules[$selector]['display'] = nimble_v2_hidden_at($node, $ids, $index) ? 'none' : $display;
    if ($container) {
        if ($display === 'flex') {
            $rules[$selector]['flex-direction'] = $layout['direction'] ?? 'column';
            $rules[$selector]['flex-wrap'] = !empty($layout['wrap']) ? 'wrap' : 'nowrap';
            if (isset($layout['justify'])) $rules[$selector]['justify-content'] = NIMBLE_V2_FLEX[$layout['justify']];
            if (isset($layout['align'])) $rules[$selector]['align-items'] = NIMBLE_V2_FLEX[$layout['align']];
        } else {
            if (isset($layout['columns'])) $rules[$selector]['grid-template-columns'] = implode(' ', $layout['columns']);
            if (isset($layout['rows'])) $rules[$selector]['grid-template-rows'] = implode(' ', $layout['rows']);
            if (isset($layout['justify']) && in_array($layout['justify'], ['start', 'center', 'end', 'stretch'], true)) $rules[$selector]['justify-items'] = $layout['justify'];
            if (isset($layout['align'])) $rules[$selector]['align-items'] = $layout['align'];
        }
        if (isset($layout['rowGap'])) $rules[$selector]['row-gap'] = $layout['rowGap'];
        if (isset($layout['columnGap'])) $rules[$selector]['column-gap'] = $layout['columnGap'];
        $width = isset($layout['contentWidth']) && $layout['contentWidth'] !== 'auto' ? $layout['contentWidth'] : '';
        if (isset($layout['padding']) || $width !== '') {
            [$top, $right, $bottom, $left] = $layout['padding'] ?? ['0px', '0px', '0px', '0px'];
            $side = static fn(string $value): string => $width !== '' ? 'max(' . $value . ',calc((100% - ' . $width . ') / 2))' : $value;
            $rules[$selector]['padding'] = $top . ' ' . $side($right) . ' ' . $bottom . ' ' . $side($left);
        }
        if (isset($layout['minHeight'])) $rules[$selector]['min-height'] = $layout['minHeight'];
    }
    if ($parentLayout !== null) {
        if (($parentLayout['mode'] ?? null) === 'stack') {
            if (isset($place['alignSelf'])) $rules[$selector]['align-self'] = NIMBLE_V2_FLEX[$place['alignSelf']];
            if (isset($place['order'])) $rules[$selector]['order'] = (string)$place['order'];
        } else {
            if (isset($place['cell'])) $rules[$selector]['grid-area'] = $place['cell'][0] . ' / ' . $place['cell'][1] . ' / span ' . $place['cell'][2] . ' / span ' . $place['cell'][3];
            if (isset($place['justifySelf'])) $rules[$selector]['justify-self'] = $place['justifySelf'];
            if (isset($place['alignSelf'])) $rules[$selector]['align-self'] = $place['alignSelf'];
        }
        if (isset($place['margin'])) $rules[$selector]['margin'] = implode(' ', $place['margin']);
        foreach ([['width', 'width'], ['height', 'height'], ['minWidth', 'min-width'], ['maxWidth', 'max-width'], ['minHeight', 'min-height'], ['maxHeight', 'max-height']] as [$key, $property]) {
            if (isset($place[$key])) $rules[$selector][$property] = nimble_v2_size_value($place[$key], str_starts_with($key, 'max'));
        }
        if (!empty($place['rotate'])) $rules[$selector]['transform'] = 'rotate(' . nimble_v2_num_string($place['rotate']) . 'deg)';
        if (isset($place['z'])) $rules[$selector]['z-index'] = (string)$place['z'];
    }
    $props = $node['props'] ?? [];
    if ($node['type'] === 'image' && isset($props['fit'])) $rules[$selector . ' img']['object-fit'] = $props['fit'];
    if ($node['type'] === 'gallery') {
        $rules[$selector]['grid-template-columns'] = 'repeat(auto-fill,minmax(' . ($props['minItemWidth'] ?? '180px') . ',1fr))';
        $rules[$selector]['gap'] = $props['gap'] ?? '16px';
        $rules[$selector . '>img']['height'] = $props['itemHeight'] ?? '250px';
    }
    if ($node['type'] === 'shape' && ($props['shape'] ?? null) === 'ellipse') $rules[$selector]['border-radius'] = '50%';
    if ($node['type'] === 'shape' && ($props['shape'] ?? null) === 'blob') $rules[$selector]['border-radius'] = '38% 62% 58% 42%';
    if ($node['type'] === 'menu') {
        $rules[$selector]['flex-direction'] = ($props['orientation'] ?? null) === 'vertical' ? 'column' : 'row';
        if (isset($props['activeColor'])) $rules[$selector . ' a[aria-current]']['color'] = nimble_v2_color_value($props['activeColor']);
    }
    nimble_v2_typography($rules, $node['type'] === 'text' ? $selector . '.t-text,' . $selector . '.t-text>*' : $selector, $style);
    if (isset($style['background'])) $rules[$selector]['background'] = nimble_v2_background_css($style['background']);
    if (isset($style['opacity'])) $rules[$selector]['opacity'] = nimble_v2_num_string($style['opacity']);
    if (isset($style['border'])) foreach (NIMBLE_V2_SIDES as $side) $rules[$selector]['border-' . $side] = in_array($side, $style['border']['sides'], true) ? $style['border']['width'] . ' ' . $style['border']['style'] . ' ' . nimble_v2_color_value($style['border']['color']) : 'none';
    if (isset($style['radius'])) $rules[$selector]['border-radius'] = implode(' ', $style['radius']);
    if (isset($style['shadow'])) $rules[$selector]['box-shadow'] = $style['shadow'] ? implode(',', array_map(static fn($item) => (!empty($item['inset']) ? 'inset ' : '') . $item['x'] . ' ' . $item['y'] . ' ' . $item['blur'] . ' ' . $item['spread'] . ' ' . nimble_v2_color_value($item['color']), $style['shadow'])) : 'none';
    if (isset($style['linkUnderline'])) $rules[$selector . ' a']['text-decoration'] = $style['linkUnderline'] ? 'underline' : 'none';
    if (isset($style['padding']) && !$container) $rules[$selector]['padding'] = implode(' ', $style['padding']);
}
function nimble_v2_css_text(array $rules): string
{
    $output = '';
    foreach ($rules as $selector => $declarations) {
        if (!$declarations) continue;
        $parts = [];
        foreach ($declarations as $property => $value) $parts[] = $property . ':' . $value;
        $output .= $selector . '{' . implode(';', $parts) . '}';
    }
    return $output;
}
function nimble_v2_diff(array $previous, array $current): array
{
    $result = [];
    foreach ($current as $selector => $declarations) foreach ($declarations as $property => $value) if (($previous[$selector][$property] ?? null) !== $value) $result[$selector][$property] = $value;
    foreach ($previous as $selector => $declarations) foreach ($declarations as $property => $value) if (!isset($current[$selector][$property])) $result[$selector][$property] = NIMBLE_V2_RESET[$property] ?? 'unset';
    return $result;
}
function nimble_v2_chunk(array $ids, callable $build): array
{
    $parts = []; $previous = null;
    foreach (array_keys($ids) as $index) {
        $rules = [];
        $build($rules, $index);
        $parts[] = $index === 0 ? nimble_v2_css_text($rules) : nimble_v2_css_text(nimble_v2_diff($previous, $rules));
        $previous = $rules;
    }
    return $parts;
}
function nimble_v2_parent_layout_at(array $parent, array $ids, int $index): array
{
    $layout = nimble_v2_cascade($parent['layout'] ?? null, $ids, $index);
    return ($layout['mode'] ?? null) === 'stack' ? $layout : array_merge($layout, ['mode' => 'grid']);
}
function nimble_v2_site_css(array $site, array $roots): string
{
    $spec = nimble_v2_spec(); $ids = nimble_v2_bp_ids($site);
    $vars = [];
    foreach ($site['design']['colors'] as $key => $hex) $vars[] = '--c-' . $key . ':' . $hex;
    $css = ':root{' . implode(';', $vars);
    foreach ($site['design']['fonts'] as $font) $css .= ';--f-' . $font['id'] . ':' . ($font['source'] === 'system' ? $spec['systemFonts'][$font['family']] : '"' . $font['family'] . '",system-ui,sans-serif');
    $css .= '}';
    foreach ($site['design']['fonts'] as $font) if ($font['source'] === 'custom') $css .= '@font-face{font-family:"' . $font['family'] . '";src:url("' . $font['src'] . '");font-display:swap}';
    $body = $site['design']['body'] ?? [];
    $bodyRules = array_values(array_filter([isset($body['font']) ? 'font-family:var(--f-' . $body['font'] . ')' : '', isset($body['color']) ? 'color:' . nimble_v2_color_value($body['color']) : '', isset($body['background']) ? 'background:' . nimble_v2_color_value($body['background']) : '']));
    $css .= 'body{' . implode(';', $bodyRules) . '}';
    $out = array_fill(0, count($ids), '');
    $add = static function (array $parts) use (&$out): void { foreach ($parts as $index => $part) $out[$index] .= $part; };
    foreach ($spec['textStyleKeys'] as $key) $add(nimble_v2_chunk($ids, static function (array &$rules, int $index) use ($site, $ids, $key): void { nimble_v2_typography($rules, '.ts-' . $key, nimble_v2_cascade($site['design']['textStyles'][$key], $ids, $index)); }));
    $walk = static function (string $id, ?array $parent) use (&$walk, &$add, $site, $ids): void {
        $node = $site['nodes'][$id];
        $add(nimble_v2_chunk($ids, static function (array &$rules, int $index) use ($site, $node, $parent, $ids): void { nimble_v2_node_rules($rules, $site, $node, $parent !== null ? nimble_v2_parent_layout_at($parent, $ids, $index) : null, $ids, $index); }));
        foreach ($node['children'] ?? [] as $child) $walk($child, $node);
    };
    foreach ($roots as $id) $walk($id, null);
    $css .= $out[0];
    foreach ($site['breakpoints'] as $offset => $bp) if ($out[$offset + 1] !== '') $css .= '@media (max-width:' . $bp['max'] . 'px){' . $out[$offset + 1] . '}';
    return $css;
}
function nimble_v2_link_href(array $site, array $link): string
{
    if ($link['to'] === 'page') return nimble_v2_page_href($site, $link['page']) . (isset($link['anchor']) ? '#' . $link['anchor'] : '');
    if ($link['to'] === 'anchor') return '#' . $link['node'];
    if ($link['to'] === 'email') return 'mailto:' . $link['address'];
    if ($link['to'] === 'phone') return 'tel:' . preg_replace('/[^0-9+]/', '', $link['number']);
    return $link['href'];
}
function nimble_v2_link_attributes(array $site, array $link): string
{
    return ' href="' . nimble_v2_e(nimble_v2_link_href($site, $link)) . '"' . (!empty($link['newTab']) ? ' target="_blank" rel="noopener noreferrer"' : '');
}
function nimble_v2_runs_html(array $site, array $runs, array $options): string
{
    $html = '';
    foreach ($runs as $run) {
        $token = $run['token'] ?? null;
        $part = str_replace("\n", '<br>', nimble_v2_e($token === 'year' ? (string)$options['year'] : ($token === 'siteName' ? $site['site']['name'] : $run['text'])));
        if (!empty($run['b'])) $part = '<strong>' . $part . '</strong>';
        if (!empty($run['i'])) $part = '<em>' . $part . '</em>';
        if (!empty($run['u'])) $part = '<u>' . $part . '</u>';
        if (!empty($run['s'])) $part = '<s>' . $part . '</s>';
        if (isset($run['color'])) $part = '<span style="color:' . nimble_v2_e(nimble_v2_color_value($run['color'])) . '">' . $part . '</span>';
        if (isset($run['link'])) $part = '<a' . nimble_v2_link_attributes($site, $run['link']) . '>' . $part . '</a>';
        $html .= $part;
    }
    return $html;
}
function nimble_v2_rich_html(array $site, array $doc, array $options): string
{
    $spec = nimble_v2_spec(); $html = '';
    foreach ($doc as $block) {
        $className = 'ts-' . ($block['style'] ?? $spec['richDefaultStyle'][$block['t']]) . (isset($block['align']) ? ' ta-' . $block['align'] : '');
        if (isset($block['items'])) {
            $html .= '<' . $block['t'] . ' class="' . $className . '">';
            foreach ($block['items'] as $item) $html .= '<li>' . nimble_v2_runs_html($site, $item, $options) . '</li>';
            $html .= '</' . $block['t'] . '>';
        } else $html .= '<' . $block['t'] . ' class="' . $className . '">' . nimble_v2_runs_html($site, $block['c'], $options) . '</' . $block['t'] . '>';
    }
    return $html;
}
function nimble_v2_render_node(array $site, string $id, array $page, array $options): string
{
    $spec = nimble_v2_spec();
    $node = $site['nodes'][$id]; $props = $node['props'] ?? []; $definition = $spec['nodeTypes'][$node['type']];
    $attributes = ' id="' . nimble_v2_e($node['id']) . '" class="n n-' . nimble_v2_e($node['id']) . ' t-' . $node['type'] . '"';
    if (!empty($definition['container'])) {
        $tag = $node['tag'] ?? ($node['type'] === 'section' ? 'section' : 'div');
        $inner = '';
        foreach ($node['children'] as $child) $inner .= nimble_v2_render_node($site, $child, $page, $options);
        return '<' . $tag . $attributes . '>' . $inner . '</' . $tag . '>';
    }
    if ($node['type'] === 'text') return '<div' . $attributes . '>' . nimble_v2_rich_html($site, $props['doc'] ?? [], $options) . '</div>';
    if ($node['type'] === 'image') {
        $image = !empty($props['src']) ? '<img loading="lazy" decoding="async" src="' . nimble_v2_e($props['src']) . '" alt="' . nimble_v2_e($props['alt'] ?? '') . '">' : '';
        return isset($props['link']) ? '<a' . $attributes . nimble_v2_link_attributes($site, $props['link']) . '>' . $image . '</a>' : '<div' . $attributes . '>' . $image . '</div>';
    }
    if ($node['type'] === 'button') {
        $label = nimble_v2_e(($props['label'] ?? '') !== '' ? $props['label'] : 'Learn more');
        return isset($props['link']) ? '<a' . $attributes . nimble_v2_link_attributes($site, $props['link']) . '>' . $label . '</a>' : '<button type="button"' . $attributes . '>' . $label . '</button>';
    }
    if ($node['type'] === 'video') {
        $video = !empty($props['src']) ? nimble_v2_video_source($props['src']) : null;
        $body = '<p class="muted">Video coming soon.</p>';
        if (($video['kind'] ?? null) === 'file') {
            $flags = (($props['controls'] ?? null) === false ? '' : ' controls') . (!empty($props['autoplay']) ? ' autoplay playsinline' : '') . (!empty($props['loop']) ? ' loop' : '') . (!empty($props['muted']) || !empty($props['autoplay']) ? ' muted' : '');
            $body = '<video' . $flags . ' preload="metadata"' . (!empty($props['poster']) ? ' poster="' . nimble_v2_e($props['poster']) . '"' : '') . ' src="' . nimble_v2_e($video['url']) . '">Your browser does not support this video.</video>';
        } elseif ($video) $body = '<iframe loading="lazy" src="' . nimble_v2_e($video['url']) . '" title="' . nimble_v2_e(($props['title'] ?? '') !== '' ? $props['title'] : 'Video') . '" allow="fullscreen; picture-in-picture; encrypted-media" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>';
        return '<div' . $attributes . '>' . $body . '</div>';
    }
    if ($node['type'] === 'gallery') {
        $images = $props['images'] ?? array_map(static fn($asset) => $asset['url'], array_slice(array_values(array_filter($site['assets'], static fn($asset) => $asset['kind'] === 'image')), 0, 6));
        $inner = '';
        foreach ($images as $url) $inner .= '<img loading="lazy" decoding="async" src="' . nimble_v2_e(nimble_v2_safe_url($url)) . '" alt="' . nimble_v2_e($props['alt'] ?? '') . '">';
        return '<div' . $attributes . '>' . $inner . '</div>';
    }
    if ($node['type'] === 'form') {
        return '<div' . $attributes . '><form action="/api/contact" method="post" data-contact-form data-block="' . nimble_v2_e($node['id']) . '"><label>Your name<input name="name" autocomplete="name" maxlength="120" required></label><label>Email address<input name="email" type="email" autocomplete="email" maxlength="254" required></label><label>Your message<textarea name="message" maxlength="5000" required></textarea></label><div class="honeypot" aria-hidden="true"><label>Leave blank<input name="website" tabindex="-1" autocomplete="off"></label></div><input type="hidden" name="token"><button class="button" type="submit">' . nimble_v2_e(($props['submitLabel'] ?? '') !== '' ? $props['submitLabel'] : 'Send message ↗') . '</button><p role="status" class="form-status" aria-live="polite"></p><small>' . nimble_v2_e($props['note'] ?? 'We use these details only to respond to your enquiry.') . '</small></form></div>';
    }
    if ($node['type'] === 'divider') return '<hr' . $attributes . '>';
    if ($node['type'] === 'menu') {
        $links = '';
        foreach ($site['pages'] as $item) $links .= '<a' . ($item['id'] === $page['id'] ? ' aria-current="page"' : '') . ' href="' . nimble_v2_e(nimble_v2_page_href($site, $item['id'])) . '">' . nimble_v2_e($item['name']) . '</a>';
        return '<nav' . $attributes . ' aria-label="Main navigation">' . $links . '</nav>';
    }
    return '<div' . $attributes . ' aria-hidden="true"></div>';
}
function nimble_v2_page_roots(array $site, array $page): array
{
    $roots = [];
    if (isset($site['header']) && $page['showHeader']) $roots[] = $site['header'];
    foreach ($page['children'] as $id) $roots[] = $id;
    if (isset($site['footer']) && $page['showFooter']) $roots[] = $site['footer'];
    return $roots;
}
function nimble_v2_render_page(array $site, array $page, array $options = []): string
{
    $settings = ['year' => $options['year'] ?? (int)gmdate('Y')];
    $e = 'nimble_v2_e';
    $header = isset($site['header']) && $page['showHeader'] ? nimble_v2_render_node($site, $site['header'], $page, $settings) : '';
    $footer = isset($site['footer']) && $page['showFooter'] ? nimble_v2_render_node($site, $site['footer'], $page, $settings) : '';
    $main = '';
    foreach ($page['children'] as $id) $main .= nimble_v2_render_node($site, $id, $page, $settings);
    $title = ($page['title'] ?? '') !== '' ? $page['title'] : $page['name'] . ' — ' . $site['site']['name'];
    $description = ($page['description'] ?? '') !== '' ? $page['description'] : $site['site']['description'];
    return '<!doctype html><html lang="' . $e($site['site']['lang']) . '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' . $e($title) . '</title><meta name="description" content="' . $e($description) . '"><meta name="robots" content="' . ($site['site']['searchVisible'] ? 'index,follow' : 'noindex,nofollow') . '"><meta property="og:title" content="' . $e($title) . '"><meta property="og:description" content="' . $e($description) . '">' . ($site['site']['socialImage'] !== '' ? '<meta property="og:image" content="' . $e($site['site']['socialImage']) . '">' : '') . '<link rel="stylesheet" href="/assets/public-v2.css"><style>' . nimble_v2_site_css($site, nimble_v2_page_roots($site, $page)) . '</style><script defer src="/assets/public.js"></script></head><body><a class="skip" href="#content">Skip to content</a>' . $header . '<main id="content">' . $main . '</main>' . $footer . '</body></html>';
}
