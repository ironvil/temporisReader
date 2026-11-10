import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

const $ = (id) => document.getElementById(id);
const output = $('output');
const MAX_PREVIEW = 200_000; // characters shown in the preview

$('platform').textContent = `Running on: ${Capacitor.getPlatform()}`;

// 1. Read any file the user picks with the system file picker.
//    No storage permission needed: Android grants access to the chosen file only.
$('picker').addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  $('file-meta').textContent = `${file.name} · ${file.type || 'unknown type'} · ${file.size.toLocaleString()} bytes`;
  try {
    const text = await file.text();
    output.textContent = text.length > MAX_PREVIEW
      ? text.slice(0, MAX_PREVIEW) + '\n\n… (truncated)'
      : text;
  } catch (err) {
    output.textContent = `Could not read file: ${err.message ?? err}`;
  }
});

// 2. Write and read a file in the app's private Documents directory.
const FILE = { path: 'hello.txt', directory: Directory.Documents };

$('write').addEventListener('click', async () => {
  try {
    const data = `Hello from Temporis Reader!\nWritten at ${new Date().toISOString()}\n`;
    const { uri } = await Filesystem.writeFile({ ...FILE, data, encoding: Encoding.UTF8 });
    $('fs-status').textContent = `Wrote ${uri}`;
  } catch (err) {
    $('fs-status').textContent = `Write failed: ${err.message ?? err}`;
  }
});

$('read').addEventListener('click', async () => {
  try {
    const { data } = await Filesystem.readFile({ ...FILE, encoding: Encoding.UTF8 });
    output.textContent = data;
    $('fs-status').textContent = 'Read hello.txt';
  } catch (err) {
    $('fs-status').textContent = `Read failed (write it first?): ${err.message ?? err}`;
  }
});
