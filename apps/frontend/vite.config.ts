import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
const backend=process.env.DEV_BACKEND_URL;
const allowedHosts=process.env.DEV_ALLOWED_HOSTS?.split(',').map(host=>host.trim()).filter(Boolean);
export default defineConfig({ root: import.meta.dirname, plugins: [react()],server:backend?{allowedHosts,proxy:{'/api':{target:backend,ws:true},'/health':{target:backend}}}:undefined });
