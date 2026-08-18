/* Genera la versión artifact a partir de public/index.html (fuente único).
   Quita el envoltorio <html>/<head> y el registro del service worker. */
const fs = require("fs");
const src = fs.readFileSync(__dirname + "/public/index.html", "utf8");

const estilo = src.slice(src.indexOf("<style>"), src.indexOf("</style>") + 8);
let cuerpo = src.slice(src.indexOf("<body>") + 6, src.lastIndexOf("</body>"));
cuerpo = cuerpo.replace(/\n<script>\s*\n\s*if\("serviceWorker" in navigator\)[\s\S]*?<\/script>\n/, "\n");

const salida = "<title>Punto de Oro</title>\n" + estilo + cuerpo;
fs.writeFileSync(process.argv[2], salida);
console.log("artifact generado: " + (salida.length / 1024).toFixed(0) + " KB, " +
  (salida.match(/<script>/g) || []).length + " bloque de script");
