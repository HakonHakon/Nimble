<?php
return [
    'production' => true,
    'public_url' => 'https://your-domain.example',
    // Generate a long random value. Remove this only after the owner account is created.
    'setup_token' => 'replace-with-a-long-private-setup-token',
    // Keep this inside the hosting account and outside any public URL if possible.
    'storage_dir' => __DIR__ . '/storage',
    'session_days' => 7,
    'max_document_bytes' => 2000000,
    'max_media_bytes' => 15728640,
    'media_quota_bytes' => 1073741824,
    'db' => [
        'host' => 'localhost',
        'name' => 'replace_database_name',
        'user' => 'replace_database_user',
        'password' => 'replace_database_password',
    ],
];
