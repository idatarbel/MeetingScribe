/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID: string;
  readonly VITE_GOOGLE_CLIENT_SECRET: string;
  readonly VITE_GOOGLE_OAUTH_SCOPES: string;
  readonly VITE_MICROSOFT_CLIENT_ID: string;
  readonly VITE_MICROSOFT_TENANT: string;
  readonly VITE_MICROSOFT_OAUTH_SCOPES: string;
  readonly VITE_DROPBOX_APP_KEY: string;
  readonly VITE_DROPBOX_APP_SECRET: string;
  readonly VITE_EXTENSION_ID: string;
  readonly VITE_DEV_MODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
