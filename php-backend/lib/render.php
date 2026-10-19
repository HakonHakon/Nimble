<?php
declare(strict_types=1);
require_once __DIR__ . '/site-model.php';

function nimble_render_block(array $site, array $block): string
{
    $e = 'nimble_escape';
    $image = static fn($value): string => $e(nimble_safe_url($value));
    $button = static fn(array $block): string => '<a class="button" href="' . $e(nimble_page_link($site, $block['buttonLink'] ?? '#contact')) . '">' . $e($block['button'] ?? $block['label'] ?? 'Learn more') . ' ↗</a>';
    $heading = '<h2>' . $e($block['title'] ?? '') . '</h2>';
    $paragraph = '<p>' . nl2br($e($block['text'] ?? ''), false) . '</p>';
    $body = '';
    $type = $block['type'] ?? '';
    if ($type === 'hero') $body = '<div><span class="eyebrow">' . $e($block['eyebrow'] ?? '') . '</span><h1>' . $e($block['title'] ?? '') . '</h1>' . $paragraph . $button($block) . '</div><div class="hero-art" aria-hidden="true"></div>';
    if (in_array($type, ['services', 'columns'], true)) {
        $cards = $block['cards'] ?? ($type === 'columns' ? [['One', 'A simple column.'], ['Two', 'Another useful point.'], ['Three', 'One more thing.']] : []);
        $body = $heading . $paragraph . '<div class="cards">';
        foreach ($cards as $card) $body .= '<article><h3>' . $e($card[0] ?? '') . '</h3><p>' . $e($card[1] ?? '') . '</p></article>';
        $body .= '</div>';
    }
    if ($type === 'split') $body = '<img loading="lazy" src="' . $image($block['image'] ?? '') . '" alt="' . $e($block['alt'] ?? '') . '"><div>' . $heading . $paragraph . $button($block) . '</div>';
    if ($type === 'video') {
        $video = nimble_video_source($block['videoUrl'] ?? ''); $body = $heading . $paragraph;
        if (($video['kind'] ?? '') === 'file') $body .= '<video controls preload="metadata"' . (!empty($block['image']) ? ' poster="' . $image($block['image']) . '"' : '') . ' src="' . $e($video['url']) . '">Your browser does not support this video.</video>';
        elseif ($video) $body .= '<iframe loading="lazy" src="' . $e($video['url']) . '" title="' . $e($block['title'] ?? 'Video') . '" allow="fullscreen; picture-in-picture; encrypted-media" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>';
        else $body .= '<p class="muted">Video coming soon.</p>';
    }
    if ($type === 'cta') $body = '<div>' . $heading . $paragraph . '</div>' . $button($block);
    if ($type === 'text') $body = $heading . $paragraph;
    if ($type === 'image') $body = '<img loading="lazy" src="' . $image($block['image'] ?? '') . '" alt="' . $e($block['alt'] ?? '') . '">';
    if ($type === 'button') $body = $button($block);
    if ($type === 'gallery') {
        $images = $block['images'] ?? array_map(static fn($asset) => $asset['url'], array_slice(array_values(array_filter($site['assets'], static fn($asset) => $asset['kind'] === 'image')), 0, 6));
        foreach ($images as $url) $body .= '<img loading="lazy" src="' . $image($url) . '" alt="' . $e($block['alt'] ?? '') . '">';
    }
    if ($type === 'quote') $body = '<blockquote>' . $paragraph . '<cite>' . $e($block['author'] ?? 'A happy client') . '</cite></blockquote>';
    if ($type === 'form') $body = $heading . $paragraph . '<form action="/api/contact" method="post" data-contact-form data-block="' . $e($block['id']) . '"><label>Your name<input name="name" autocomplete="name" maxlength="120" required></label><label>Email address<input name="email" type="email" autocomplete="email" maxlength="254" required></label><label>Your message<textarea name="message" maxlength="5000" required></textarea></label><div class="honeypot" aria-hidden="true"><label>Leave blank<input name="website" tabindex="-1" autocomplete="off"></label></div><input type="hidden" name="token"><button class="button" type="submit">Send message ↗</button><p role="status" class="form-status" aria-live="polite"></p><small>We use these details only to respond to your enquiry.</small></form>';
    return '<section id="' . $e($block['id'] ?? '') . '" class="block ' . $e($type) . '"' . (!empty($block['bg']) ? ' style="background-color:' . $e($block['bg']) . '"' : '') . '>' . $body . '</section>';
}

function nimble_render_page(array $site, array $page): string
{
    $e = 'nimble_escape'; $theme = NIMBLE_THEMES[$site['theme']] ?? NIMBLE_THEMES['purple'];
    $radius = !empty($site['site']['rounded']) ? '14px' : '0'; $bodyFont = NIMBLE_FONTS[$site['site']['bodyFont'] ?? 'sans']; $headingFont = NIMBLE_FONTS[$site['site']['headingFont'] ?? 'sans'];
    $style = ':root{--accent:' . $theme . ';--radius:' . $radius . ';font-family:' . $bodyFont . '}h1,h2,h3{font-family:' . $headingFont . '}';
    $nav = '<nav aria-label="Main navigation"><a class="logo" href="./">' . $e($site['site']['name']) . '</a><div class="links">';
    foreach ($site['pages'] as $item) $nav .= '<a' . ($item['id'] === $page['id'] ? ' aria-current="page"' : '') . ' href="' . $e(nimble_page_link($site, $item['id'])) . '">' . $e($item['name']) . '</a>';
    $nav .= '</div></nav><main id="content">';
    foreach ($page['blocks'] as $id) if (isset($site['blocks'][$id])) $nav .= nimble_render_block($site, $site['blocks'][$id]);
    $nav .= '</main>';
    $social = !empty($site['site']['socialImage']) ? '<meta property="og:image" content="' . $e(nimble_safe_url($site['site']['socialImage'])) . '">' : '';
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' . $e($page['name']) . ' — ' . $e($site['site']['name']) . '</title><meta name="description" content="' . $e($site['site']['description']) . '"><meta name="robots" content="' . (!empty($site['site']['searchVisible']) ? 'index,follow' : 'noindex,nofollow') . '"><meta property="og:title" content="' . $e($site['site']['name']) . '"><meta property="og:description" content="' . $e($site['site']['description']) . '">' . $social . '<link rel="stylesheet" href="/assets/public.css"><style>' . $style . '</style><script defer src="/assets/public.js"></script></head><body><a class="skip" href="#content">Skip to content</a><div class="wrap">' . $nav . '<footer>© ' . date('Y') . ' ' . $e($site['site']['name']) . '</footer></div></body></html>';
}
