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
    if ($value['kind'] === 'video') return isset($value['color']) ? nimble_v2_color_value($value['color']) : 'transparent';
    $overlay = isset($value['overlay']) ? 'linear-gradient(' . nimble_v2_color_value($value['overlay']) . ',' . nimble_v2_color_value($value['overlay']) . '),' : '';
    $position = isset($value['focal']) ? nimble_v2_num_string($value['focal'][0]) . '% ' . nimble_v2_num_string($value['focal'][1]) . '%' : preg_replace('/-/', ' ', $value['position'], 1);
    return $overlay . 'url("' . $value['src'] . '") ' . $position . '/' . $value['size'] . ' ' . ($value['repeat'] ? 'repeat' : 'no-repeat') . (isset($value['color']) ? ' ' . nimble_v2_color_value($value['color']) : '');
}
function nimble_v2_shadow_text(array $list): string
{
    return $list ? implode(',', array_map(static fn($item) => (!empty($item['inset']) ? 'inset ' : '') . $item['x'] . ' ' . $item['y'] . ' ' . $item['blur'] . ' ' . $item['spread'] . ' ' . nimble_v2_color_value($item['color']), $list)) : 'none';
}
function nimble_v2_video_backgrounds(array $node): array
{
    $list = [];
    foreach ($node['style'] ?? [] as $values) {
        $value = $values['background'] ?? null;
        if (($value['kind'] ?? null) !== 'video') continue;
        $known = false;
        foreach ($list as $item) if ($item['src'] === $value['src']) $known = true;
        if (!$known) $list[] = ['src' => $value['src'], 'poster' => $value['poster'] ?? null];
    }
    return $list;
}
const NIMBLE_V2_HOVER_PROPERTIES = ['color', 'background', 'border-color', 'box-shadow', 'opacity', 'scale', 'translate'];
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
    if ($node['type'] === 'gallery' && in_array($node['props']['layout'] ?? null, ['masonry', 'slider'], true)) $display = 'block';
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
    if ($node['type'] === 'image' && isset($props['focal'])) $rules[$selector . ' img']['object-position'] = nimble_v2_num_string($props['focal'][0]) . '% ' . nimble_v2_num_string($props['focal'][1]) . '%';
    if ($node['type'] === 'gallery') {
        $layout = $props['layout'] ?? 'grid';
        if ($layout === 'grid') {
            $rules[$selector]['grid-template-columns'] = 'repeat(auto-fill,minmax(' . ($props['minItemWidth'] ?? '180px') . ',1fr))';
            $rules[$selector]['gap'] = $props['gap'] ?? '16px';
            $rules[$selector . (nimble_v2_gallery_figures($props) ? '>figure img' : '>img')]['height'] = $props['itemHeight'] ?? '250px';
        } elseif ($layout === 'masonry') {
            $rules[$selector]['column-width'] = $props['minItemWidth'] ?? '180px';
            $rules[$selector]['column-gap'] = $props['gap'] ?? '16px';
            $rules[$selector . '>figure']['margin-bottom'] = $props['gap'] ?? '16px';
        } else {
            $rules[$selector . ' .g-track']['gap'] = $props['gap'] ?? '0px';
            $rules[$selector . ' figure img']['height'] = $props['itemHeight'] ?? '420px';
        }
    }
    if ($node['type'] === 'shape' && ($props['shape'] ?? null) === 'ellipse') $rules[$selector]['border-radius'] = '50%';
    if ($node['type'] === 'shape' && ($props['shape'] ?? null) === 'blob') $rules[$selector]['border-radius'] = '38% 62% 58% 42%';
    if ($node['type'] === 'divider' && (isset($props['thickness']) || isset($props['lineStyle']))) {
        $side = ($props['orientation'] ?? null) === 'vertical' ? 'border-left' : 'border-top';
        // Two classes, so it wins over the .t-divider.is-vertical default.
        if (isset($props['thickness'])) $rules[$selector . '.t-divider'][$side . '-width'] = $props['thickness'];
        if (isset($props['lineStyle'])) $rules[$selector . '.t-divider'][$side . '-style'] = $props['lineStyle'];
    }
    if ($node['type'] === 'icon' && isset($props['weight'])) $rules[$selector . ' svg']['stroke-width'] = nimble_v2_num_string($props['weight']);
    if ($node['type'] === 'menu') {
        $rules[$selector]['flex-direction'] = ($props['orientation'] ?? null) === 'vertical' ? 'column' : 'row';
        if (isset($props['activeColor'])) $rules[$selector . ' a[aria-current]']['color'] = nimble_v2_color_value($props['activeColor']);
    }
    nimble_v2_typography($rules, $node['type'] === 'text' ? $selector . '.t-text,' . $selector . '.t-text>*' : $selector, $style);
    if (isset($style['background'])) $rules[$selector]['background'] = nimble_v2_background_css($style['background']);
    if (isset($style['opacity'])) $rules[$selector]['opacity'] = nimble_v2_num_string($style['opacity']);
    if (isset($style['border'])) foreach (NIMBLE_V2_SIDES as $side) $rules[$selector]['border-' . $side] = in_array($side, $style['border']['sides'], true) ? $style['border']['width'] . ' ' . $style['border']['style'] . ' ' . nimble_v2_color_value($style['border']['color']) : 'none';
    if (isset($style['radius'])) $rules[$selector]['border-radius'] = implode(' ', $style['radius']);
    if (isset($style['shadow'])) $rules[$selector]['box-shadow'] = nimble_v2_shadow_text($style['shadow']);
    $videos = nimble_v2_video_backgrounds($node);
    if ($videos) {
        $active = ($style['background']['kind'] ?? null) === 'video' ? $style['background'] : null;
        $rules[$selector]['isolation'] = 'isolate';
        foreach ($videos as $i => $item) $rules[$selector . '>.bg-v' . $i]['display'] = ($active['src'] ?? null) === $item['src'] ? 'block' : 'none';
        $rules[$selector . '>.bg-overlay']['background'] = isset($active['overlay']) ? nimble_v2_color_value($active['overlay']) : 'transparent';
    }
    if (isset($style['blendMode'])) $rules[$selector]['mix-blend-mode'] = $style['blendMode'];
    if (isset($style['filter'])) $rules[$selector]['filter'] = NIMBLE_V2_FILTERS[$style['filter']];
    if (isset($style['scrollEffect'])) {
        $rules[$selector]['--fx'] = $style['scrollEffect'];
        $rules[$selector]['background-attachment'] = $style['scrollEffect'] === 'reveal' ? 'fixed' : 'scroll';
    }
    if (isset($node['hover'])) {
        $hover = $node['hover']; $on = $selector . ':hover'; $duration = $hover['duration'] ?? 200;
        $rules[$selector]['transition'] = implode(',', array_map(static fn($property) => $property . ' ' . $duration . 'ms ease', NIMBLE_V2_HOVER_PROPERTIES));
        if (isset($hover['color'])) $rules[$node['type'] === 'text' ? $selector . '.t-text:hover,' . $selector . '.t-text:hover>*' : $on]['color'] = nimble_v2_color_value($hover['color']);
        if (isset($hover['background'])) $rules[$on]['background'] = nimble_v2_background_css($hover['background']);
        if (isset($hover['borderColor'])) $rules[$on]['border-color'] = nimble_v2_color_value($hover['borderColor']);
        if (isset($hover['shadow'])) $rules[$on]['box-shadow'] = nimble_v2_shadow_text($hover['shadow']);
        if (isset($hover['opacity'])) $rules[$on]['opacity'] = nimble_v2_num_string($hover['opacity']);
        if (isset($hover['scale'])) $rules[$on]['scale'] = nimble_v2_num_string($hover['scale']);
        if (isset($hover['translateY'])) $rules[$on]['translate'] = '0 ' . $hover['translateY'];
    }
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
    // Several font IDs can share one family (e.g. "heading" copied from an imported font); each face is declared once.
    $faces = [];
    foreach ($site['design']['fonts'] as $font) {
        if ($font['source'] !== 'custom') continue;
        if (isset($font['src'])) $faces['@font-face{font-family:"' . $font['family'] . '";src:url("' . $font['src'] . '");font-display:swap}'] = true;
        foreach ($font['files'] ?? [] as $file) $faces['@font-face{font-family:"' . $font['family'] . '";src:url("' . $file['src'] . '");font-weight:' . $file['weight'] . ';font-style:' . $file['style'] . ';font-display:swap}'] = true;
    }
    $css .= implode('', array_keys($faces));
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
const NIMBLE_V2_FILTERS = ['none' => 'none', 'grayscale' => 'grayscale(1)', 'sepia' => 'sepia(0.8)', 'blur' => 'blur(3px)', 'brighten' => 'brightness(1.2)', 'darken' => 'brightness(0.75)', 'contrast' => 'contrast(1.35)', 'saturate' => 'saturate(1.6)', 'vintage' => 'sepia(0.35) contrast(1.1) saturate(0.8) brightness(1.05)'];
// Plain grids keep the original <img> markup; captions, lightbox and other layouts use figures.
function nimble_v2_gallery_figures(array $props): bool
{
    return (isset($props['layout']) && $props['layout'] !== 'grid') || !empty($props['lightbox']) || !empty($props['captions']);
}
// Icons are drawn from the bundled set in the spec: stroked 24×24 paths.
function nimble_v2_icon_svg(string $name): string
{
    $paths = '';
    foreach (nimble_v2_spec()['icons'][$name] ?? [] as $d) $paths .= '<path d="' . $d . '"/>';
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' . $paths . '</svg>';
}
// Inline styles of a rich text run (colour first, so colour-only runs keep their v1 markup).
function nimble_v2_run_css(array $run): string
{
    return implode(';', array_filter([
        isset($run['color']) ? 'color:' . nimble_v2_color_value($run['color']) : null,
        isset($run['highlight']) ? 'background-color:' . nimble_v2_color_value($run['highlight']) : null,
        isset($run['font']) ? 'font-family:var(--f-' . $run['font'] . ')' : null,
        isset($run['size']) ? 'font-size:' . $run['size'] : null,
        isset($run['weight']) ? 'font-weight:' . $run['weight'] : null,
    ], static fn($part) => $part !== null));
}
function nimble_v2_block_css(array $block): string
{
    return implode(';', array_filter([
        isset($block['lineHeight']) ? 'line-height:' . nimble_v2_num_string($block['lineHeight']) : null,
        isset($block['letterSpacing']) ? 'letter-spacing:' . $block['letterSpacing'] : null,
    ], static fn($part) => $part !== null));
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
        $css = nimble_v2_run_css($run);
        if ($css !== '') $part = '<span style="' . nimble_v2_e($css) . '">' . $part . '</span>';
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
        $css = nimble_v2_block_css($block);
        $open = '<' . $block['t'] . ' class="' . $className . '"' . ($css !== '' ? ' style="' . nimble_v2_e($css) . '"' : '') . '>';
        if (isset($block['items'])) {
            $html .= $open;
            foreach ($block['items'] as $item) $html .= '<li>' . nimble_v2_runs_html($site, $item, $options) . '</li>';
            $html .= '</' . $block['t'] . '>';
        } else $html .= $open . nimble_v2_runs_html($site, $block['c'], $options) . '</' . $block['t'] . '>';
    }
    return $html;
}
function nimble_v2_render_node(array $site, string $id, array $page, array $options): string
{
    $spec = nimble_v2_spec();
    $node = $site['nodes'][$id]; $props = $node['props'] ?? []; $definition = $spec['nodeTypes'][$node['type']];
    $effect = false;
    foreach ($node['style'] ?? [] as $values) if (isset($values['scrollEffect']) && $values['scrollEffect'] !== 'none') $effect = true;
    $attributes = ' id="' . nimble_v2_e($node['id']) . '" class="n n-' . nimble_v2_e($node['id']) . ' t-' . $node['type'] . '"' . ($effect ? ' data-fx' : '');
    if (!empty($definition['container'])) {
        $tag = $node['tag'] ?? ($node['type'] === 'section' ? 'section' : 'div');
        $inner = '';
        $videos = nimble_v2_video_backgrounds($node);
        foreach ($videos as $i => $item) $inner .= '<video class="bg-video bg-v' . $i . '" src="' . nimble_v2_e($item['src']) . '"' . ($item['poster'] !== null ? ' poster="' . nimble_v2_e($item['poster']) . '"' : '') . ' autoplay muted loop playsinline preload="metadata" aria-hidden="true"></video>';
        if ($videos) $inner .= '<span class="bg-overlay" aria-hidden="true"></span>';
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
        if (isset($props['icon'])) {
            $text = !empty($props['hideLabel']) ? '<span class="vh">' . $label . '</span>' : '<span>' . $label . '</span>';
            $label = ($props['iconPosition'] ?? null) === 'end' ? $text . nimble_v2_icon_svg($props['icon']) : nimble_v2_icon_svg($props['icon']) . $text;
        }
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
        $image = static fn($url) => '<img loading="lazy" decoding="async" src="' . nimble_v2_e(nimble_v2_safe_url($url)) . '" alt="' . nimble_v2_e($props['alt'] ?? '') . '">';
        if (!nimble_v2_gallery_figures($props)) return '<div' . $attributes . '>' . implode('', array_map($image, $images)) . '</div>';
        $layout = $props['layout'] ?? 'grid';
        $figures = '';
        foreach (array_values($images) as $i => $url) {
            $caption = $props['captions'][$i] ?? '';
            $figures .= '<figure class="g-item">' . (!empty($props['lightbox']) ? '<a class="g-open" href="' . nimble_v2_e(nimble_v2_safe_url($url)) . '">' . $image($url) . '</a>' : $image($url)) . ($caption !== '' ? '<figcaption>' . nimble_v2_e($caption) . '</figcaption>' : '') . '</figure>';
        }
        $open = '<div' . str_replace(' t-gallery"', ' t-gallery is-' . $layout . '"', $attributes) . (!empty($props['lightbox']) ? ' data-lightbox' : '');
        if ($layout !== 'slider') return $open . '>' . $figures . '</div>';
        return $open . ' data-slider' . (!empty($props['autoplay']) ? ' data-autoplay="' . ($props['interval'] ?? 5) . '"' : '') . ' aria-roledescription="carousel"><div class="g-track">' . $figures . '</div><button type="button" class="g-prev" aria-label="Previous image">‹</button><button type="button" class="g-next" aria-label="Next image">›</button></div>';
    }
    if ($node['type'] === 'audio') {
        $title = ($props['title'] ?? '') !== '' ? '<p class="a-title">' . nimble_v2_e($props['title']) . '</p>' : '';
        $player = !empty($props['src']) ? '<audio controls preload="metadata"' . (!empty($props['autoplay']) ? ' autoplay' : '') . (!empty($props['loop']) ? ' loop' : '') . ' src="' . nimble_v2_e($props['src']) . '">Your browser does not support audio.</audio>' : '<p class="muted">Audio coming soon.</p>';
        return '<div' . $attributes . '>' . $title . $player . '</div>';
    }
    if ($node['type'] === 'form') {
        return '<div' . $attributes . '><form action="/api/contact" method="post" data-contact-form data-block="' . nimble_v2_e($node['id']) . '"><label>Your name<input name="name" autocomplete="name" maxlength="120" required></label><label>Email address<input name="email" type="email" autocomplete="email" maxlength="254" required></label><label>Your message<textarea name="message" maxlength="5000" required></textarea></label><div class="honeypot" aria-hidden="true"><label>Leave blank<input name="website" tabindex="-1" autocomplete="off"></label></div><input type="hidden" name="token"><button class="button" type="submit">' . nimble_v2_e(($props['submitLabel'] ?? '') !== '' ? $props['submitLabel'] : 'Send message ↗') . '</button><p role="status" class="form-status" aria-live="polite"></p><small>' . nimble_v2_e($props['note'] ?? 'We use these details only to respond to your enquiry.') . '</small></form></div>';
    }
    if ($node['type'] === 'icon') {
        $icon = $props['icon'] ?? 'star';
        $svg = nimble_v2_icon_svg($icon);
        $name = ($props['label'] ?? '') !== '' ? ' aria-label="' . nimble_v2_e($props['label']) . '"' : '';
        if (isset($props['link'])) return '<a' . $attributes . nimble_v2_link_attributes($site, $props['link']) . ($name !== '' ? $name : ' aria-label="' . nimble_v2_e($icon) . '"') . '>' . $svg . '</a>';
        return '<span' . $attributes . ($name !== '' ? ' role="img"' . $name : ' aria-hidden="true"') . '>' . $svg . '</span>';
    }
    if ($node['type'] === 'divider') return ($props['orientation'] ?? null) === 'vertical' ? '<hr' . str_replace(' t-divider"', ' t-divider is-vertical"', $attributes) . ' aria-orientation="vertical">' : '<hr' . $attributes . '>';
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
