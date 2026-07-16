const https = require("https");
const fs = require("fs");
const path = require("path");

const url = "https://unpkg.com/pnpm@8.15.6/dist/pnpm.cjs";
const dest = path.join(__dirname, "../pnpm8.js");

console.log(`Downloading pnpm v8 from ${url}...`);
const file = fs.createWriteStream(dest);

https.get(url, (response) => {
  if (response.statusCode !== 200) {
    console.error(`Failed to download: Status Code ${response.statusCode}`);
    process.exit(1);
  }

  const totalSize = parseInt(response.headers["content-length"] || "0", 10);
  let downloadedSize = 0;

  response.pipe(file);

  response.on("data", (chunk) => {
    downloadedSize += chunk.length;
    if (totalSize > 0) {
      const percentage = ((downloadedSize / totalSize) * 100).toFixed(2);
      process.stdout.write(`Progress: ${percentage}% (${(downloadedSize / 1024 / 1024).toFixed(2)} MB / ${(totalSize / 1024 / 1024).toFixed(2)} MB)\r`);
    } else {
      process.stdout.write(`Downloaded: ${(downloadedSize / 1024 / 1024).toFixed(2)} MB\r`);
    }
  });

  file.on("finish", () => {
    file.close();
    console.log("\nDownload completed successfully!");
    process.exit(0);
  });
}).on("error", (err) => {
  fs.unlink(dest, () => {});
  console.error(`Error downloading file: ${err.message}`);
  process.exit(1);
});
