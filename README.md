[한국어](README.ko.md)

# Finder PDF Converter

Convert one or more files to separate PDFs from Finder's Quick Actions menu.

| File type | Required app |
| --- | --- |
| HWP, HWPX | Hancom Office HWP for Mac (Korean interface) |
| DOCX | Microsoft Word for Mac |
| PPTX | Microsoft PowerPoint for Mac |
| XLSX | Microsoft Excel for Mac |
| CSV | None beyond macOS |
| PNG, JPG, JPEG, HEIC, HEIF | None beyond macOS |
| Android DNG RAW (see the scope below) | None beyond macOS |
| TXT, MD, MARKDOWN | None beyond macOS |

Tested on macOS 26.6.2. This is the tested version, not a stated minimum requirement.

Hancom HWP, Word, PowerPoint, and Excel must be installed as Mac apps; their web versions do not work with this tool. You only need the app for the file type you want to convert. Open each Office app once and finish its initial setup before using it here. File extensions are case-insensitive.

The Quick Action menu and conversion results follow Finder’s preferred language: **Convert to PDF** in English and **PDF로 변환** in Korean. If Finder has no app-specific language setting, they follow the macOS preferred-language list. The first supported language (English or Korean) is used. If neither appears, English is used. Region settings and Terminal’s `LANG` do not select the interface language. Installer and installation-check (`doctor.sh`) messages remain in Korean.

<a id="설치"></a>

## Install

### 1. Download the files

You do not need Git. On the [GitHub repository page](https://github.com/dartworklabs/finder-pdf-converter), choose the green **Code → Download ZIP** button. Double-click the downloaded ZIP to extract it, then move the extracted folder somewhere you plan to keep it. Check that it contains `install.sh` and `README.md`.

If you already use Git, you can clone the repository instead:

```sh
git clone https://github.com/dartworklabs/finder-pdf-converter.git
```

### 2. Run the installer

1. Open **Terminal** on your Mac. You can find it by searching for `Terminal` in Spotlight.
2. Type `cd` followed by **one space**. Drag the actual folder containing `install.sh` from Finder into the Terminal window, then press Return. This fills in the folder path for you.
3. Paste the following command and press Return:

```sh
bash ./install.sh
```

When you see `설치했습니다:` (“Installed:”) followed by a path, installation is complete. No administrator access or `sudo` is required.

The installer copies the Quick Action and its executables to `~/Library/Services/PDF로 변환.workflow`. It will not overwrite an unrelated item with that name. It **only updates an installation made from the same source folder at the same absolute path**. It also refuses to update an installation whose folder or executables have been replaced with symbolic links.

### 3. Enable it in Finder

Control-click or right-click a file in Finder and open **Quick Actions → Customize** (`빠른 동작 → 사용자화` on a Korean Mac). In the Finder extensions list, enable **Convert to PDF** (**PDF로 변환** in Korean). If it does not appear immediately, open a new Finder window and check again.

### 4. Try a single PNG

Start with a PNG, which needs no additional app. Put a PNG, such as a screenshot, in a folder you can write to. Make sure there is no PDF with the same base name in that folder.

1. Control-click or right-click the PNG in Finder and choose **Quick Actions → Convert to PDF** (**빠른 동작 → PDF로 변환** in Korean).
2. Check that the result dialog says **Completed: 1 · Skipped: 0 · Failed: 0** (**완료 1개 · 건너뜀 0개 · 실패 0개** in Korean).
3. Check that a PDF with the same base name appears beside the PNG. Open it and confirm that the image is visible.

If a PDF with that name already exists, the converter skips the file. Try another PNG or rename the existing PDF before trying again.

Once the PNG works, try the document types you need. If Office asks for folder access, see [Office folder access](#office-folder-access). For Hancom HWP permissions, see [Hancom HWP permissions and operation](#hancom-hwp-permissions-and-operation). Follow those instructions as well if macOS asks for permission to control an app.

The installed bundle keeps its existing name, `PDF로 변환.workflow`, in both languages. Only the displayed menu label changes. The language of the PDF content and the required Korean interface of Hancom HWP are unaffected.

## Update

**Keep the original source folder at the same absolute path.** If you rename or move it, the installer treats it as a different source and refuses to update the existing installation.

- **If you downloaded a ZIP:** Extract the new ZIP somewhere else, then copy its contents into the folder you originally installed from. A folder with the same name in a different parent folder is still a different path. Do not run the installer directly from a newly downloaded folder with a suffix such as `(1)` or `-main`. If you keep personal files in the original folder, review what will be replaced before copying.
- **If you used Git:** Run `git pull --ff-only` in the original folder. If it fails, review and resolve the changes instead of forcing an overwrite.

After updating the files, use the steps in [Run the installer](#2-run-the-installer) to open **the original folder** in Terminal, then run:

```sh
bash ./install.sh
```

When you see `설치를 갱신했습니다.` (“Installation updated.”), repeat the PNG check. If you see `기존 항목이 있어 설치하지 않았습니다:` (“Not installed because an item already exists:”), check that you are using the same source-folder path as the existing installation. To install from a new location, first remove your existing installation using the instructions below, then install from the new folder.

## Check the installation

In Terminal, open the folder containing `install.sh` and run:

```sh
bash ./doctor.sh
```

This compares the current source folder's executables and Quick Action files with the installed copies, byte for byte. It does not change files or launch apps, and it does not print your actual home-directory path or email addresses. Exit codes are `0` if all files match, `1` for a missing installation, differing contents, or a read failure, and `2` for a non-macOS system or invalid execution conditions. See [Install](#install) and [Update](#update) if the installation needs attention.

The check looks for Hancom HWP, Word, PowerPoint, and Excel under their standard app names in `/Applications` and `~/Applications`. Missing apps do not affect the exit code; check manually if you installed them elsewhere. This check does not verify app startup, licensing, macOS permissions, or actual conversion. Complete the [PNG check](#4-try-a-single-png) as well.

## Uninstall

1. In Finder, choose **Go → Go to Folder…** and enter `~/Library/Services`.
2. **Confirm that `PDF로 변환.workflow` is the item you installed with this tool**, then move only that item to the Trash. Do not remove an item of uncertain origin with the same name, or any other Quick Action.

This removes the Quick Action only. Your source files and converted PDFs remain in place. No administrator access or `sudo` is required.

## Use

Select files in Finder, Control-click or right-click, and choose **Quick Actions → Convert to PDF** (**빠른 동작 → PDF로 변환** in Korean). Each PDF is saved beside its source with the same base name: for example, `report.docx` becomes `report.pdf`. Selecting multiple files creates a separate PDF for each file; it does not merge them. The result dialog shows completed, skipped, and failed counts, along with a result for each file. Its title, confirmation button, and converter-authored reasons use the same language. File names and paths retain their original spelling; unrecognized app or macOS diagnostics may appear verbatim beneath **Technical details**.

Existing PDFs are never overwritten. If you select files with the same base name in the same folder, such as `report.docx` and `report.png`, the first successful conversion creates `report.pdf` and the others are skipped. Unsupported file types are skipped. Unreadable files, symbolic links, and corrupt files are reported as failures. A failure does not stop the remaining files from being processed.

Conversion uses temporary copies of the source files. Documents you already have open in Hancom HWP, Word, PowerPoint, or Excel are left open; only the conversion copies are closed. Unsaved changes in those apps are not included, so save the latest version to the source file before converting. If another conversion is already running, a message asks you to wait for it to finish and try again.

### Text and Markdown

Text, Markdown, and CSV files support UTF-8, UTF-16 with a byte-order mark (BOM), and CP949/EUC-KR. Files without a BOM are read as UTF-8 first, with CP949/EUC-KR used only if UTF-8 decoding fails. A file valid in both is treated as UTF-8. If Korean text looks wrong, save the source as UTF-8 and convert again.

The input limit is 16 MiB per file, and the output limit is 2,000 pages. Markdown also has limits of 2 million UTF-16 code units, 50,000 lines, and 20,000 blocks. Each Markdown table may contain up to 32 columns and 5,000 body rows.

Markdown renders headings, lists, blockquotes, code, tables, and basic text emphasis. Tables wider than six columns are presented as a series of rows, with each cell shown as `column name: value`. Raw HTML is displayed as text, not executed. Link destinations and images are not fetched. Unsupported Markdown syntax may remain as plain source text.

### Spreadsheets and CSV

XLSX conversion uses Excel's PDF export and follows the print areas and page settings saved in the workbook. Hidden sheets are excluded, and external links are not automatically updated.

CSV files are rendered as comma-separated tables. The converter handles quoted commas, quoted line breaks, and escaped double quotes (`""`). It displays every cell literally and does not assume the first row is a header. Files with up to five columns use a table with numbered columns; files with six or more use one entry per row, with cells shown as `column number: value`. Formulas and HTML are not executed, and external links are not fetched. An empty file produces a notice that there is no content.

CSV limits are 20,000 rows, 1,024 columns per row, 100,000 cells in total, and 262,144 characters per cell. Conversion stops if the estimated displayed content, including row and column labels, exceeds 4,194,304 UTF-16 code units. Malformed quoting or a file exceeding these limits is reported as a failure.

### Images

Images become single-page PDFs with their orientation metadata applied. PNG and JPEG support a single image. HEIC/HEIF uses the file's primary still image; auxiliary images and depth information are not added as separate pages. Converting an entire animation or burst sequence is not supported.

## DNG RAW support and verification

The tested inputs are a Google Pixel 4 XL CFA RAW DNG and a Samsung Galaxy Z Fold7 DNG 1.7 Linear RAW file with JPEG XL compression. A `.dng` extension alone does not establish compatibility: devices, shooting modes, and compression methods differ. Support for all Android DNG files or all DNG 1.7 files is not guaranteed.

The converter develops DNG images with the macOS RAW decoder and saves the result as a single-page PDF. It accepts DNG 1.x files using the Classic TIFF structure with one unambiguous full-resolution CFA or Linear RAW image. BigTIFF and files with multiple RAW images whose selection is ambiguous are rejected. Limits are 512 MiB per input and 210 million pixels for both the sensor image and developed result. A small embedded preview alone is not accepted as a successful conversion.

Orientation metadata is applied. The PDF does not preserve the original DNG's sensor data or capture metadata. Brightness and color may differ from the camera app or another RAW developer. See [DNG verification evidence](verification/DNG.md) for the tested files, observed quality, independent comparisons, and limitations.

You do not need to add private RAW photos to this repository. To test your own DNG, first copy it into a separate writable folder and make sure there is no PDF with the same base name. From the repository folder, run:

```sh
./convert.sh --no-dialog -- "/absolute/path/photo.dng"
```

Open the PDF created beside the DNG and check its orientation, dimensions, and color. If conversion fails, check whether the device and DNG format can be developed by your current macOS version. Existing PDFs are skipped, so rename the previous PDF before repeating the test.

### Optional quality checks

These checks are optional and are not required for normal conversion. If your Python environment has `rawpy`, `Pillow`, `numpy`, and `PyMuPDF`, and the `exiftool` command is available, run this from the repository folder:

```sh
python3 verification/verify-dng-quality.py "/absolute/path/photo.dng" "/absolute/path/photo.pdf"
```

If you have a camera JPEG from the same shot, add `--reference "/absolute/path/camera-photo.jpg"` to use it as a comparison. The `--self-test` option checks the verifier's own orientation and color discrimination.

The verifier reads the DNG and PDF and reports dimensions, orientation, and color diagnostics. For files LibRaw can develop, it compares the PDF with an independent RAW rendering. If LibRaw cannot decode the RAW and a large embedded JPEG is used instead, the report states that limitation. A small thumbnail cannot qualify as a full-resolution RAW check. White balance and tone vary between RAW developers, so pixel-for-pixel equality is not the pass criterion.

## Office folder access

When Finder cannot access an Office app's temporary folder, the converter uses the corresponding `Word`, `PowerPoint`, or `Excel` folder under `~/Library/Caches/FinderPDFConverter/OfficeExports/`. Office may then show a **Grant File Access** dialog (`파일 액세스 부여`). Click **Select…** (`선택...`), select the folder for the app named in the request, and click **Grant Access** (`액세스 허가`). If a button is disabled, bring the selection dialog to the front by clicking it, then check again.

Word, PowerPoint, and Excel each request access separately. Later conversions reuse the same folder, so you do not need to approve a new temporary folder every time. If you cancel access or Office asks again, grant access using the same steps and retry. Only randomly named source copies and intermediate PDFs are temporarily stored there. When conversion ends, the converter removes only the files it created for that run.

## Hancom HWP permissions and operation

Hancom HWP conversion uses on-screen controls and requires its **Korean interface**. In **System Settings → Privacy & Security → Accessibility**, allow **Finder**. If macOS asks for permission to control Hancom HWP, Word, PowerPoint, or Excel, allow the relevant request as well. When running directly from Terminal, the terminal app may need these permissions.

Close any save dialogs or warning dialogs in Hancom HWP before starting. During conversion, keep Hancom HWP in front and avoid using its other documents or menus. Switching apps or an unexpected dialog can interrupt conversion. After reading a failure message, manually dismiss any remaining warning dialog and try again. To regenerate a PDF that already exists, rename or remove the existing PDF yourself first.

## Run from Terminal

To run without the result dialog, use `--no-dialog`. Terminal conversion summaries follow the same Finder/macOS language choice as the Quick Action; changing `LANG` does not change them. Put paths containing spaces in quotes:

```sh
./convert.sh --no-dialog -- "/absolute/path/report.docx" "/absolute/path/photo.heic"
```

Exit codes are `0` when all files succeed or are skipped, `1` when any file fails, and `2` for missing input, startup failures, or another conversion already in progress.

## License

The source code and documentation are licensed under the [MIT License](LICENSE). Hancom HWP and Microsoft Office must be installed separately and are subject to their vendors' licenses.
