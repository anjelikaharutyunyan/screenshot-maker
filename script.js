// Set the worker source explicitly to avoid deprecation warning
pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js";

async function compressImageToSizeRange(canvas, initialQuality, minSize = 30000, maxSize = 60000) {
    let quality = initialQuality;
    const maxIterations = 15; // Increase iterations for better fine-tuning
    let iterations = 0;

    while (iterations < maxIterations) {
        const blob = await new Promise((resolve) => {
            canvas.toBlob(resolve, 'image/jpeg', quality);
        });

        const blobSize = blob.size;
        if (blobSize < minSize && quality < 0.95) {
            quality += 0.05; // Increase quality to make the file larger
        } else if (blobSize > maxSize && quality > 0.1) {
            quality -= 0.05; // Decrease quality to make the file smaller
        } else {
            // Image is within acceptable size range
            return convertBlobToDataURL(blob);
        }

        iterations++;
    }

    // If unable to meet size constraints, return the best effort result
    const finalBlob = await new Promise((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', quality);
    });
    return convertBlobToDataURL(finalBlob);
}

// Helper function to convert Blob to Data URL
function convertBlobToDataURL(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('FileReader failed'));
        reader.readAsDataURL(blob);
    });
}

// Create a progress bar for a PDF file
function createProgressBar(pdfFileName, totalPages) {
    const progressContainer = document.getElementById('progressContainer');
    const progressWrapper = document.createElement('div');
    progressWrapper.className = 'progress-bar-wrapper';
    progressWrapper.dataset.filename = pdfFileName;

    const progressLabel = document.createElement('span');
    progressLabel.textContent = `${pdfFileName}: 0%`;
    progressWrapper.appendChild(progressLabel);

    const progressBar = document.createElement('div');
    progressBar.className = 'progress-bar';
    const progressInner = document.createElement('div');
    progressBar.appendChild(progressInner);
    progressWrapper.appendChild(progressBar);

    progressContainer.appendChild(progressWrapper);
    return progressInner;
}

// Update the progress of a PDF file
function updateProgress(pdfFileName, pageNum, totalPages) {
    const progressWrapper = document.querySelector(`.progress-bar-wrapper[data-filename="${pdfFileName}"]`);
    if (progressWrapper) {
        const progressInner = progressWrapper.querySelector('.progress-bar div');
        const percentage = (pageNum / totalPages) * 100;
        progressInner.style.width = `${percentage}%`;
        progressWrapper.querySelector('span').textContent = `${pdfFileName}: ${Math.round(percentage)}%`;
    }
}

// Resize canvas to a maximum width
function resizeCanvas(originalCanvas, maxWidth) {
    if (originalCanvas.width <= maxWidth) return originalCanvas;

    const scaleFactor = maxWidth / originalCanvas.width;
    const resizedCanvas = document.createElement('canvas');
    resizedCanvas.width = maxWidth;
    resizedCanvas.height = originalCanvas.height * scaleFactor;

    const ctx = resizedCanvas.getContext('2d');
    ctx.drawImage(originalCanvas, 0, 0, resizedCanvas.width, resizedCanvas.height);
    return resizedCanvas;
}

// Process an individual PDF page
async function processPage(pdf, pageNum, pdfFileName, totalPages) {
    const page = await pdf.getPage(pageNum);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const scale = 1.5;
    const viewport = page.getViewport({ scale });
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({ canvasContext: ctx, viewport }).promise;

    // Update progress after rendering
    updateProgress(pdfFileName, pageNum, totalPages);

    const resizedCanvas = resizeCanvas(canvas, 1024);
    const compressedDataURL = await compressImageToSizeRange(resizedCanvas, 0.9, 50000, 100000);
    imagesData.push({ imgData: compressedDataURL, pdfFileName, pageNum });
}

// Render a PDF file
async function renderPDF(pdfData, pdfFileName) {
    const pdf = await pdfjsLib.getDocument(pdfData).promise;
    const totalPages = pdf.numPages;

    const progressBar = createProgressBar(pdfFileName, totalPages);

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
        await processPage(pdf, pageNum, pdfFileName, totalPages);
    }
}

// Read file as ArrayBuffer
function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(new Uint8Array(reader.result));
        reader.onerror = () => reject(new Error('File reading failed'));
        reader.readAsArrayBuffer(file);
    });
}

// Process files sequentially
async function processFilesSequentially(files) {
    for (const file of files) {
        try {
            const pdfData = await readFileAsArrayBuffer(file);
            await renderPDF(pdfData, file.name);
        } catch (err) {
            console.error('Error processing file:', file.name, err);
        }
    }
}

// Main script
let imagesData = [];

document.getElementById('fileSelector').addEventListener('change', function (event) {
    const files = Array.from(event.target.files);
    processFilesSequentially(files);
});

// Convert Data URL to Blob
function dataURLtoBlob(dataURL) {
    const byteString = atob(dataURL.split(',')[1]);
    const arrayBuffer = new ArrayBuffer(byteString.length);
    const uintArray = new Uint8Array(arrayBuffer);
    for (let i = 0; i < byteString.length; i++) {
        uintArray[i] = byteString.charCodeAt(i);
    }
    return new Blob([arrayBuffer], { type: 'image/png' });
}

// Additional functions like `downloadBtn` and `clearQueueBtn` remain unchanged.
// Enable the "Download All" button after processing files
async function processFilesSequentially(files) {
    let filesProcessed = 0; // Track how many files have been processed
    for (const file of files) {
        try {
            const pdfData = await readFileAsArrayBuffer(file);
            await renderPDF(pdfData, file.name);
            filesProcessed++;
        } catch (err) {
            console.error('Error processing file:', file.name, err);
        }
    }

    // Enable buttons only after all files are processed
    if (filesProcessed > 0) {
        document.getElementById('downloadBtn').disabled = false;
        document.getElementById('clearQueueBtn').disabled = false;
    }
}
// Function to download images as a ZIP file
document.getElementById('downloadBtn').addEventListener('click', async function () {
    if (imagesData.length === 0) {
        alert('No images to download!');
        return;
    }

    // Disable the button to prevent multiple clicks
    const downloadBtn = document.getElementById('downloadBtn');
    downloadBtn.disabled = true;

    // Show the loader
    const loader = document.getElementById('loader');
    loader.style.display = 'flex';

    try {
        const zip = new JSZip();

        // Group images by PDF file name
        const groupedFiles = imagesData.reduce((acc, { imgData, pdfFileName, pageNum }) => {
            if (!acc[pdfFileName]) {
                acc[pdfFileName] = [];
            }
            const imgDataBinary = dataURLtoBlob(imgData);
            acc[pdfFileName].push({ imgDataBinary, pageNum });
            return acc;
        }, {});

        Object.keys(groupedFiles).forEach(pdfFileName => {
            const pdfFolder = zip.folder(pdfFileName.replace('.pdf', ''));
            groupedFiles[pdfFileName].forEach(({ imgDataBinary, pageNum }) => {
                pdfFolder.file(`${pdfFileName}, ${pageNum}.png`, imgDataBinary);
            });
        });
        
        // Generate ZIP file
        const content = await zip.generateAsync({ type: 'blob' });

        // Create a download link and trigger the download
        const link = document.createElement('a');
        link.href = URL.createObjectURL(content);
        link.download = 'pdf_screenshots.zip';
        link.click();
    } catch (error) {
        console.error('Error while downloading:', error);
        alert('An error occurred during the download.');
    } finally {
        // Hide the loader and re-enable the button
        loader.style.display = 'none';
        downloadBtn.disabled = false;
    }
});

document.getElementById('clear').addEventListener('click', function () {
    imagesData = [];

    const progressContainer = document.getElementById('progressContainer');
    progressContainer.innerHTML = '';

    document.getElementById('downloadBtn').disabled = true;
    document.getElementById('clear').disabled = true;

    alert('Queue cleared successfully!');
});
