import { defineConfig } from 'vite';

// The UI uses browser modules, including the dynamic FFmpeg imports used by
// AMR decoding. Vite resolves those imports into deployable browser chunks.
export default defineConfig({
  root: 'src/ui',
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
  },
});
