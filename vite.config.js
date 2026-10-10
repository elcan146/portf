import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

export default defineConfig({
  plugins: [
    {
      name: 'serve-assets',
      configureServer(server) {
        // Serve 3D GLB models
        server.middlewares.use('/3d', (req, res, next) => {
          const relativePath = decodeURIComponent(req.url.split('?')[0]);
          const filePath = path.join(process.cwd(), '3d', relativePath);
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            res.setHeader('Content-Type', 'model/gltf-binary');
            return fs.createReadStream(filePath).pipe(res);
          }
          next();
        });

        // Serve custom fonts
        server.middlewares.use('/font', (req, res, next) => {
          const relativePath = decodeURIComponent(req.url.split('?')[0]);
          const filePath = path.join(process.cwd(), 'font', relativePath);
          if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            res.setHeader('Content-Type', 'font/woff2');
            return fs.createReadStream(filePath).pipe(res);
          }
          next();
        });
      },
      closeBundle() {
        const src3d = path.join(process.cwd(), '3d');
        const dest3d = path.join(process.cwd(), 'dist', '3d');
        if (fs.existsSync(src3d)) {
          fs.cpSync(src3d, dest3d, { recursive: true });
        }

        const srcFont = path.join(process.cwd(), 'font');
        const destFont = path.join(process.cwd(), 'dist', 'font');
        if (fs.existsSync(srcFont)) {
          fs.cpSync(srcFont, destFont, { recursive: true });
        }

        const srcVideos = path.join(process.cwd(), 'videos');
        const destVideos = path.join(process.cwd(), 'dist', 'videos');
        if (fs.existsSync(srcVideos)) {
          fs.cpSync(srcVideos, destVideos, { recursive: true });
        }

        const srcCockpit = path.join(process.cwd(), 'cockpit');
        const destCockpit = path.join(process.cwd(), 'dist', 'cockpit');
        if (fs.existsSync(srcCockpit)) {
          fs.cpSync(srcCockpit, destCockpit, { recursive: true });
        }
      }
    }
  ],
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(process.cwd(), 'index.html'),
        mobile: path.resolve(process.cwd(), 'm/index.html'),
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    // Allow public tunnel hostnames (cloudflared, localtunnel, localhost.run)
    allowedHosts: ['.trycloudflare.com', '.loca.lt', '.lhr.life', '.pinggy.link', '.elcanismayilov.com', 'elcanismayilov.com']
  }
});
