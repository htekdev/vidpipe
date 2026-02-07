# FFmpeg Setup

**video-auto-note-taker** requires FFmpeg 6.0+ for audio extraction, silence removal, short-clip cutting, and caption burning. Both `ffmpeg` and `ffprobe` must be available.

---

## Quick Check

Verify that FFmpeg is already installed and accessible:

```bash
ffmpeg -version
ffprobe -version
```

If both commands print version info (6.0 or higher), you're ready to go.

---

## Windows

### Option A: winget (recommended)

```powershell
winget install Gyan.FFmpeg
```

After installation, restart your terminal. FFmpeg will be available on PATH.

### Option B: Chocolatey

```powershell
choco install ffmpeg
```

### Option C: Manual download

1. Download the latest **full build** from [gyan.dev/ffmpeg/builds](https://www.gyan.dev/ffmpeg/builds/) (choose "ffmpeg-release-full.7z")
2. Extract to a permanent location, e.g. `C:\tools\ffmpeg`
3. Add the `bin` folder to your system PATH:
   ```powershell
   # Permanently add to user PATH
   [Environment]::SetEnvironmentVariable(
     "Path",
     "$([Environment]::GetEnvironmentVariable('Path', 'User'));C:\tools\ffmpeg\bin",
     "User"
   )
   ```
4. Restart your terminal and verify with `ffmpeg -version`

### Windows ARM64 (important)

The bundled `@ffmpeg-installer/ffmpeg` npm package **does not support Windows ARM64**. You must install FFmpeg manually and point the tool to it:

1. Download an ARM64 build from [github.com/ArsThauwormo/FFmpeg-Builds-ARM64](https://github.com/ArsThauwormo/FFmpeg-Builds-ARM64) or build from source
2. Extract to a known location, e.g. `C:\tools\ffmpeg-arm64\`
3. Set the paths in your `.env` or as environment variables:

```env
FFMPEG_PATH=C:\tools\ffmpeg-arm64\bin\ffmpeg.exe
FFPROBE_PATH=C:\tools\ffmpeg-arm64\bin\ffprobe.exe
```

Or pass them as environment variables:

```powershell
$env:FFMPEG_PATH = "C:\tools\ffmpeg-arm64\bin\ffmpeg.exe"
$env:FFPROBE_PATH = "C:\tools\ffmpeg-arm64\bin\ffprobe.exe"
video-auto-note-taker --once ./my-video.mp4
```

---

## macOS

### Homebrew (recommended)

```bash
brew install ffmpeg
```

This installs both `ffmpeg` and `ffprobe` and adds them to PATH.

### MacPorts

```bash
sudo port install ffmpeg
```

---

## Linux

### Ubuntu / Debian

```bash
sudo apt update
sudo apt install ffmpeg
```

### Fedora

```bash
sudo dnf install ffmpeg
```

### Arch Linux

```bash
sudo pacman -S ffmpeg
```

### Alpine (Docker)

```dockerfile
RUN apk add --no-cache ffmpeg
```

---

## Setting Custom Paths

If FFmpeg is installed to a non-standard location (or you have multiple versions), tell the tool where to find the binaries.

### Via `.env` file

```env
FFMPEG_PATH=/usr/local/bin/ffmpeg
FFPROBE_PATH=/usr/local/bin/ffprobe
```

### Via environment variables

```bash
export FFMPEG_PATH=/opt/ffmpeg/bin/ffmpeg
export FFPROBE_PATH=/opt/ffmpeg/bin/ffprobe
video-auto-note-taker --watch-dir ./watch
```

### Windows example

```env
FFMPEG_PATH=C:\tools\ffmpeg\bin\ffmpeg.exe
FFPROBE_PATH=C:\tools\ffmpeg\bin\ffprobe.exe
```

> **Note:** When `FFMPEG_PATH` and `FFPROBE_PATH` are not set, the tool defaults to `ffmpeg` and `ffprobe` — expecting them to be on your system PATH.

---

## Verifying Your Installation

Run the built-in version check:

```bash
ffmpeg -version 2>&1 | head -1
# Expected: ffmpeg version 6.x.x or 7.x.x ...

ffprobe -version 2>&1 | head -1
# Expected: ffprobe version 6.x.x or 7.x.x ...
```

Then test that the tool can find them:

```bash
video-auto-note-taker --verbose --once /path/to/short-test-video.mp4
```

In verbose mode, you'll see the FFmpeg paths logged during the ingestion stage.

---

## Fonts

**Montserrat Bold** is bundled with the package in `assets/fonts/` — no manual installation required. FFmpeg is configured to use the bundled font file automatically when burning captions.

> **Fallback:** If you need to use a different font, you can install it system-wide and update the caption generation settings. But the default setup works out of the box.

---

## Troubleshooting

### "ffmpeg: command not found"

FFmpeg is not on your PATH. Either:
- Install it using the instructions above
- Set `FFMPEG_PATH` and `FFPROBE_PATH` to absolute paths

### "ffprobe: command not found" (but ffmpeg works)

Some minimal FFmpeg installations omit `ffprobe`. Reinstall the **full** package (not the "essentials" build).

### Old FFmpeg version causes errors

Some features (e.g. advanced subtitle filters, certain codec options) require FFmpeg 6.0+. Check your version:

```bash
ffmpeg -version
```

If it's below 6.0, upgrade using the instructions for your platform above.

### Windows ARM64: "@ffmpeg-installer/ffmpeg unsupported platform"

This is expected. The bundled FFmpeg package does not include ARM64 binaries. Follow the [Windows ARM64](#windows-arm64-important) section above to install manually and set the paths.
