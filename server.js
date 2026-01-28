const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');

const app = express();
const PORT = process.env.PORT || 3000;

// Configurar almacenamiento temporal
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = './uploads';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 500 * 1024 * 1024 // 500 MB límite
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv', '.webm'];
    const ext = path.extname(file.originalname).toLowerCase();
    
    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Formato no permitido. Solo: ${allowedTypes.join(', ')}`));
    }
  }
});

// Middleware
app.use(express.json());

// Endpoint de salud
app.get('/health', (req, res) => {
  ffmpeg.getAvailableFormats((err, formats) => {
    if (err) {
      return res.status(500).json({
        status: 'unhealthy',
        error: 'ffmpeg no está instalado o configurado correctamente',
        message: err.message
      });
    }
    
    res.json({
      status: 'healthy',
      ffmpeg: 'available',
      timestamp: new Date().toISOString()
    });
  });
});

// Endpoint principal de conversión
app.post('/convert', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: 'No se proporcionó ningún archivo'
    });
  }

  const inputPath = req.file.path;
  const outputFilename = path.parse(req.file.filename).name + '.mp3';
  const outputPath = path.join('./uploads', outputFilename);
  
  // Obtener parámetros opcionales
  const bitrate = req.body.bitrate || '192k';
  const returnFile = req.body.return_file === 'true';

  try {
    // Convertir usando ffmpeg
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .toFormat('mp3')
        .audioBitrate(bitrate)
        .on('start', (commandLine) => {
          console.log('FFmpeg iniciado:', commandLine);
        })
        .on('progress', (progress) => {
          console.log(`Progreso: ${progress.percent}%`);
        })
        .on('end', () => {
          console.log('Conversión completada');
          resolve();
        })
        .on('error', (err) => {
          console.error('Error en ffmpeg:', err);
          reject(err);
        })
        .save(outputPath);
    });

    // Obtener información del archivo
    const stats = fs.statSync(outputPath);
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

    // Si se solicita retornar el archivo directamente
    if (returnFile) {
      res.download(outputPath, outputFilename, (err) => {
        // Limpiar archivos después de enviar
        cleanupFiles([inputPath, outputPath]);
        
        if (err) {
          console.error('Error al enviar archivo:', err);
        }
      });
    } else {
      // Retornar información JSON
      const result = {
        success: true,
        input_file: req.file.originalname,
        output_file: outputFilename,
        output_path: outputPath,
        file_size: stats.size,
        file_size_mb: parseFloat(fileSizeMB),
        bitrate: bitrate,
        download_url: `${req.protocol}://${req.get('host')}/download/${outputFilename}`,
        message: 'Conversión completada exitosamente'
      };

      // Limpiar solo el archivo de entrada
      cleanupFiles([inputPath]);

      res.json(result);
    }

  } catch (error) {
    // Limpiar archivos en caso de error
    cleanupFiles([inputPath, outputPath]);

    res.status(500).json({
      success: false,
      error: 'Error al convertir el archivo',
      details: error.message
    });
  }
});

// Endpoint para descargar archivos convertidos
app.get('/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filepath = path.join('./uploads', filename);

  if (!fs.existsSync(filepath)) {
    return res.status(404).json({
      success: false,
      error: 'Archivo no encontrado'
    });
  }

  res.download(filepath, filename, (err) => {
    if (err) {
      console.error('Error al descargar:', err);
    }
    
    // Opcional: limpiar archivo después de descargar
    // cleanupFiles([filepath]);
  });
});

// Endpoint para convertir desde URL
app.post('/convert-url', express.json(), async (req, res) => {
  const { url, bitrate = '192k' } = req.body;

  if (!url) {
    return res.status(400).json({
      success: false,
      error: 'Se requiere una URL en el body'
    });
  }

  const timestamp = Date.now();
  const outputFilename = `converted_${timestamp}.mp3`;
  const outputPath = path.join('./uploads', outputFilename);

  try {
    // Verificar que el directorio existe
    if (!fs.existsSync('./uploads')) {
      fs.mkdirSync('./uploads', { recursive: true });
    }

    // Convertir directamente desde la URL
    await new Promise((resolve, reject) => {
      ffmpeg(url)
        .toFormat('mp3')
        .audioBitrate(bitrate)
        .on('start', (commandLine) => {
          console.log('FFmpeg iniciado:', commandLine);
        })
        .on('progress', (progress) => {
          console.log(`Progreso: ${progress.percent}%`);
        })
        .on('end', () => {
          console.log('Conversión completada');
          resolve();
        })
        .on('error', (err) => {
          console.error('Error en ffmpeg:', err);
          reject(err);
        })
        .save(outputPath);
    });

    // Obtener información del archivo
    const stats = fs.statSync(outputPath);
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);

    res.json({
      success: true,
      source_url: url,
      output_file: outputFilename,
      output_path: outputPath,
      file_size: stats.size,
      file_size_mb: parseFloat(fileSizeMB),
      bitrate: bitrate,
      download_url: `${req.protocol}://${req.get('host')}/download/${outputFilename}`
    });

  } catch (error) {
    cleanupFiles([outputPath]);

    res.status(500).json({
      success: false,
      error: 'Error al convertir desde URL',
      details: error.message
    });
  }
});

// Endpoint para limpiar archivos antiguos
app.post('/cleanup', (req, res) => {
  const uploadsDir = './uploads';
  const maxAge = 3600000; // 1 hora en milisegundos
  const now = Date.now();
  let cleaned = 0;

  try {
    if (fs.existsSync(uploadsDir)) {
      const files = fs.readdirSync(uploadsDir);
      
      files.forEach(file => {
        const filePath = path.join(uploadsDir, file);
        const stats = fs.statSync(filePath);
        const age = now - stats.mtimeMs;

        if (age > maxAge) {
          fs.unlinkSync(filePath);
          cleaned++;
        }
      });
    }

    res.json({
      success: true,
      files_cleaned: cleaned,
      message: `Se eliminaron ${cleaned} archivos antiguos`
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Error al limpiar archivos',
      details: error.message
    });
  }
});

// Función auxiliar para limpiar archivos
function cleanupFiles(files) {
  files.forEach(file => {
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        console.log(`Archivo eliminado: ${file}`);
      }
    } catch (err) {
      console.error(`Error al eliminar ${file}:`, err.message);
    }
  });
}

// Manejo de errores global
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'El archivo es demasiado grande. Máximo 500 MB'
      });
    }
  }

  res.status(500).json({
    success: false,
    error: error.message
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🎵 Servidor de conversión MP4 a MP3 iniciado');
  console.log('='.repeat(60));
  console.log(`\n📡 Servidor escuchando en: http://localhost:${PORT}`);
  console.log('\n📋 Endpoints disponibles:');
  console.log(`   GET  ${PORT}/health              - Estado del servidor`);
  console.log(`   POST ${PORT}/convert             - Convertir archivo subido`);
  console.log(`   POST ${PORT}/convert-url         - Convertir desde URL`);
  console.log(`   GET  ${PORT}/download/:filename  - Descargar archivo`);
  console.log(`   POST ${PORT}/cleanup             - Limpiar archivos antiguos`);
  console.log('\n💡 Ejemplos de uso:');
  console.log(`\n   # Subir y convertir:`);
  console.log(`   curl -X POST -F "file=@video.mp4" http://localhost:${PORT}/convert`);
  console.log(`\n   # Con bitrate personalizado:`);
  console.log(`   curl -X POST -F "file=@video.mp4" -F "bitrate=320k" http://localhost:${PORT}/convert`);
  console.log(`\n   # Descargar directamente:`);
  console.log(`   curl -X POST -F "file=@video.mp4" -F "return_file=true" http://localhost:${PORT}/convert -o audio.mp3`);
  console.log('\n' + '='.repeat(60) + '\n');

  // Verificar ffmpeg
  ffmpeg.getAvailableFormats((err) => {
    if (err) {
      console.error('⚠️  ADVERTENCIA: ffmpeg no está disponible');
      console.error('   Instala ffmpeg para que el servidor funcione correctamente');
    } else {
      console.log('✅ ffmpeg está disponible y listo\n');
    }
  });
});

// Manejo de cierre graceful
process.on('SIGTERM', () => {
  console.log('SIGTERM recibido, cerrando servidor...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\nSIGINT recibido, cerrando servidor...');
  process.exit(0);
});