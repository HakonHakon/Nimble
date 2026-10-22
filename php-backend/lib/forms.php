<?php
declare(strict_types=1);
// Form builder submissions: validates the posted values against the published field list and
// detects uploaded file types by content. Port of lib/forms.mjs.

const NIMBLE_FORM_FILE_TYPES = ['pdf' => 'application/pdf', 'png' => 'image/png', 'jpg' => 'image/jpeg', 'webp' => 'image/webp', 'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'doc' => 'application/msword', 'txt' => 'text/plain; charset=utf-8'];

// File types accepted by file fields, recognised by their first bytes (and the name for text and Word).
function nimble_form_file_type(string $bytes, string $name): ?string
{
    $lower = strtolower($name);
    if (str_starts_with($bytes, '%PDF-')) return 'pdf';
    if (str_starts_with($bytes, "\x89PNG\r\n\x1a\n")) return 'png';
    if (str_starts_with($bytes, "\xff\xd8\xff")) return 'jpg';
    if (substr($bytes, 0, 4) === 'RIFF' && substr($bytes, 8, 4) === 'WEBP') return 'webp';
    if (str_starts_with($bytes, "PK\x03\x04") && str_ends_with($lower, '.docx')) return 'docx';
    if (str_starts_with($bytes, "\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1") && str_ends_with($lower, '.doc')) return 'doc';
    if (str_ends_with($lower, '.txt') && !str_contains($bytes, "\0") && mb_check_encoding($bytes, 'UTF-8')) return 'txt';
    return null;
}
function nimble_form_clean_name(mixed $name): string
{
    $clean = trim(mb_substr((string)preg_replace('/[\x00-\x1f\x7f"\\\\\/<>:|?*]+/u', '_', is_string($name) && $name !== '' ? $name : 'file'), 0, 120));
    return $clean !== '' ? $clean : 'file';
}
// Returns entries for the inbox, files still to be stored and the classic columns (name, email, summary).
function nimble_validate_submission(array $fields, mixed $input): array
{
    $limits = nimble_v2_spec()['limits'];
    $values = is_array($input) && !array_is_list($input) ? $input : [];
    $entries = []; $files = [];
    $missing = static fn($value) => $value === null || $value === '' || (is_array($value) && array_is_list($value) && !$value);
    foreach ($fields as $field) {
        $raw = $values[$field['id']] ?? null;
        $label = '“' . $field['label'] . '”';
        if ($missing($raw) || ($field['type'] === 'checkbox' && !isset($field['options']) && $raw !== 'yes' && $raw !== true)) {
            if (!empty($field['required'])) nimble_error('Fill in ' . $label . '.');
            continue;
        }
        if ($field['type'] === 'file') {
            if (!is_array($raw) || !is_string($raw['data'] ?? null) || !preg_match('#^data:[a-z0-9.+/-]*;base64,([a-z0-9+/]+={0,2})$#i', $raw['data'], $match)) nimble_error('Upload a file for ' . $label . '.');
            $bytes = (string)base64_decode($match[1], true);
            if (strlen($bytes) > $limits['formFileBytes']) nimble_error('Files must be at most ' . (int)round($limits['formFileBytes'] / 1048576) . ' MB.');
            $extension = nimble_form_file_type($bytes, (string)($raw['name'] ?? ''));
            if ($extension === null) nimble_error($label . ' must be a PDF, image, Word or text file.');
            $entry = ['id' => $field['id'], 'label' => $field['label'], 'type' => 'file', 'name' => nimble_form_clean_name($raw['name'] ?? ''), 'size' => strlen($bytes)];
            $files[] = ['bytes' => $bytes, 'extension' => $extension, 'index' => count($entries)];
            $entries[] = $entry;
            continue;
        }
        if ($field['type'] === 'checkbox' && isset($field['options'])) {
            if (!is_array($raw) || !array_is_list($raw)) nimble_error('Choose from the options for ' . $label . '.');
            foreach ($raw as $item) if (!in_array($item, $field['options'], true)) nimble_error('Choose from the options for ' . $label . '.');
            $value = array_values(array_filter($field['options'], static fn($option) => in_array($option, $raw, true)));
        } elseif ($field['type'] === 'checkbox') $value = 'Yes';
        else {
            if (!is_string($raw)) nimble_error('Invalid value for ' . $label . '.');
            $value = trim($raw);
            if ($value === '') { if (!empty($field['required'])) nimble_error('Fill in ' . $label . '.'); continue; }
            $max = $field['type'] === 'textarea' ? 5000 : 500;
            if (mb_strlen($value, 'UTF-8') > $max) nimble_error($label . ' can be at most ' . $max . ' characters.');
            if ($field['type'] === 'email' && !preg_match('/^[^\s@<>"\']{1,64}@[^\s@<>"\']{1,190}\.[^\s@<>"\']{2,}$/u', $value)) nimble_error('Enter a valid email address for ' . $label . '.');
            if ($field['type'] === 'phone' && !preg_match('/^\+?[0-9() .-]{3,30}$/', $value)) nimble_error('Enter a valid phone number for ' . $label . '.');
            if ($field['type'] === 'number' && !preg_match('/^-?\d{1,15}(\.\d{1,6})?$/', $value)) nimble_error('Enter a number for ' . $label . '.');
            if ($field['type'] === 'date' && (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $value, $date) || !checkdate((int)$date[2], (int)$date[3], (int)$date[1]))) nimble_error('Enter a valid date for ' . $label . '.');
            if (in_array($field['type'], ['select', 'radio'], true) && !in_array($value, $field['options'], true)) nimble_error('Choose one of the options for ' . $label . '.');
        }
        $entries[] = ['id' => $field['id'], 'label' => $field['label'], 'type' => $field['type'], 'value' => $value];
    }
    $text = static fn($entry) => $entry['type'] === 'file' ? $entry['name'] : (is_array($entry['value']) ? implode(', ', $entry['value']) : $entry['value']);
    $name = 'Website visitor'; $email = '';
    foreach ($entries as $entry) if ($entry['type'] === 'text') { $name = mb_substr($entry['value'], 0, 120); break; }
    foreach ($entries as $entry) if ($entry['type'] === 'email') { $email = strtolower($entry['value']); break; }
    $message = mb_substr(implode("\n", array_map(static fn($entry) => $entry['label'] . ': ' . $text($entry), $entries)), 0, 5000);
    return ['entries' => $entries, 'files' => $files, 'name' => $name, 'email' => $email, 'message' => $message !== '' ? $message : '(empty)'];
}
