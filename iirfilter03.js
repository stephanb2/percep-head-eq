// Audio context
let audioContext;
let isPlaying = false;
let loopInterval;

// Base 10 reference frequencies (ANSI standard)
const frequencyTable = [31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 
    800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000];

// History of user selections
const outputdBGain = 0  //output gain to make up gain loss from filters
const amplitudeHistory = Array(frequencyTable.length).fill(0);


// Get frequency from slider position
function sliderToFreq(sliderVal) {
  const index = sliderVal;
  return frequencyTable[index];
}

// Find closest slider position for a given frequency
function freqToSlider(freq) {
  let closestIndex = 0;
  let minDiff = Math.abs(frequencyTable[0] - freq);
  
  for (let i = 1; i < frequencyTable.length; i++) {
    const diff = Math.abs(frequencyTable[i] - freq);
    if (diff < minDiff) {
      minDiff = diff;
      closestIndex = i;
    }
  }
  return closestIndex;
}

// Create frequency tick marks for datalist
function createFrequencyTicks() {
  const datalist = document.getElementById('frequency-ticks');
  datalist.innerHTML = '';
  
  // Create major ticks at certain points
  const majorTicks = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  
  majorTicks.forEach(freq => {
    if (frequencyTable.includes(freq)) {
      const option = document.createElement('option');
      const sliderVal =  frequencyTable.indexOf(freq);
      option.value = sliderVal;
      option.label = freq >= 1000 ? `${freq/1000}k` : freq;
      datalist.appendChild(option);
    }
  });
}

// Audio processing -------- 
// Create white noise buffer
function createNoiseBuffer(duration) {
  const sampleRate = audioContext.sampleRate;
  const bufferSize = sampleRate * duration;
  const buffer = audioContext.createBuffer(1, bufferSize, sampleRate);
  const data = buffer.getChannelData(0);
  
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1; // Random value between -1 and 1
  }
  
  return buffer;
}

function createFiliFilter(frequency) {
  const sampleRate = audioContext.sampleRate;
  //  Instance of a filter coefficient calculator
  var iirCalculator = new Fili.CalcCascades();

  // get available filters
  var availableFilters = iirCalculator.available();

  // calculate filter coefficients
  var iirFilterCoeffs = iirCalculator.bandpass({
      order: 12, // cascade biquad filters (max: 12)
      characteristic: 'butterworth',
      Fs: sampleRate, // sampling frequency
      Fc: frequency,  // center frequency for bandpass
      BW: 1.0         // bandwidth for bandstop and bandpass filters
    });

  // create a filter instance from the calculated coeffs
  var iirFilter = new Fili.IirFilter(iirFilterCoeffs);
  return iirFilter
}

function createFilteredBuffer(noiseBuffer, frequency) {
  const iirFilter = createFiliFilter(frequency)

  // Get original audio data
  const origData = noiseBuffer.getChannelData(0);

  // Create new buffer for filtered data
  const filteredBuffer = audioContext.createBuffer(1, noiseBuffer.length, audioContext.sampleRate);
  const filteredData = filteredBuffer.getChannelData(0);

  // Apply filter
  const filteredValues = iirFilter.multiStep(Array.from(origData));
  // Copy filtered values to buffer
  for (let i = 0; i < filteredValues.length; i++) {
    filteredData[i] = filteredValues[i];
  }
  return filteredBuffer
}

// Create a gain node
function createGain(dbGain) {
  const gain = audioContext.createGain();
  gain.gain.value = Math.pow(10, dbGain / 20); // Convert dB to linear gain
  return gain;
}


// Play filtered noise --------------
function playFilteredNoise() {
  if (audioContext === undefined) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  
  isPlaying = true;
  document.getElementById('play-button').disabled = true;
  document.getElementById('stop-button').disabled = false;
  
  const loopLength = 1000; // 1 second (2 x 0.5 second sounds)
  // Create noise buffer and fixed filter noise
  const noiseBuffer = createNoiseBuffer(0.5);
  
  function playSounds() {
    const variableFreqIndex = document.getElementById('frequency-slider').value;
    const variableFreq = sliderToFreq(variableFreqIndex)
    const pinkNoiseGain = frequencyTable.indexOf(500) - variableFreqIndex
    
    // Create gain nodes
    const variableDbGain = parseFloat(document.getElementById('amplitude-slider').value);
    const variableGain = createGain(variableDbGain + pinkNoiseGain + outputdBGain);
    const fixedGain = createGain(outputdBGain); // Fixed gain
    
    // Create variable noise source
    const variableSource = audioContext.createBufferSource();
    variableSource.buffer = createFilteredBuffer(noiseBuffer, variableFreq);
    const fixedSource = audioContext.createBufferSource();
    fixedSource.buffer = createFilteredBuffer(noiseBuffer, 500);
    
    // Connect variable frequency path
    variableSource.connect(variableGain);
    variableGain.connect(audioContext.destination);

    // Connect fixed frequency path
    fixedSource.connect(fixedGain);
    fixedGain.connect(audioContext.destination);

    // Start sounds
    const currentTime = audioContext.currentTime;
    variableSource.start(currentTime);
    variableSource.stop(currentTime + 0.5);
    fixedSource.start(currentTime + 0.5);
    fixedSource.stop(currentTime + 1.0);
  }
  
  // Play immediately
  playSounds();
  
  // Set up loop
  loopInterval = setInterval(() => {
    if (isPlaying) {
      playSounds();
    } else {
      clearInterval(loopInterval);
    }
  }, loopLength);
}

// Stop playing audio
function stopAudio() {
  isPlaying = false;
  clearInterval(loopInterval);
  
  // Update history display
  updateHistoryDisplay();
  
  document.getElementById('play-button').disabled = false;
  document.getElementById('stop-button').disabled = true;
}

// Update history display
function updateHistoryDisplay() {
  const historyList = document.getElementById('history-list');
  historyList.innerHTML = 'freq(Hz)&#09;level(dB)<br />';
  
  amplitudeHistory.forEach((value, index) => {
    historyList.innerHTML += `${sliderToFreq(index)}&#09;${value}<br />`
  });
}


// save values to file
function saveHistory() {
  var fileContent = "* freq(Hz) level(dB)\n";
  amplitudeHistory.forEach((value, index) => {
    fileContent += `${sliderToFreq(index)} ${value}\n`
  });

  var blob = new Blob([fileContent ], { type: 'text/plain' });
  var a = document.createElement('a');
  a.download = 'download.txt';
  a.href = window.URL.createObjectURL(blob);
  a.click();
}


// Initialize the app ---------- 
function init() {
  // Generate frequency table using standard 1/3 octave bands
  // frequencyTable = generateThirdOctaveBands();
  
  // Set up frequency slider
  const freqSlider = document.getElementById('frequency-slider');
  const freqValue = document.getElementById('frequency-value');
  
  // Create frequency tick marks
  createFrequencyTicks();

  freqSlider.addEventListener('input', () => {
    const freq = sliderToFreq(freqSlider.value);
    freqValue.textContent = `${freq} Hz`;
    // recall amplitude from table
    ampSlider.value = amplitudeHistory[freqSlider.value]
    ampValue.textContent = `${ampSlider.value} dB`;
  });
  
  // Set initial value to 1kHz or closest available
  freqSlider.value = freqToSlider(1000);
  freqValue.textContent = "1000 Hz"

  // Set up amplitude slider
  const ampSlider = document.getElementById('amplitude-slider');
  const ampValue = document.getElementById('amplitude-value');
  
  ampSlider.addEventListener('input', () => {
    ampValue.textContent = `${ampSlider.value} dB`;
    // console.info("freq %d: %d", freqSlider.value, ampSlider.value)
    amplitudeHistory[freqSlider.value] = ampSlider.value
  });
  
  // Set up buttons
  document.getElementById('play-button').addEventListener('click', playFilteredNoise);
  document.getElementById('stop-button').addEventListener('click', stopAudio);
  document.getElementById('save-history').addEventListener('click', () => {
    //amplitudeHistory.length = 0;
    //updateHistoryDisplay();
    saveHistory();
  });
}

// Initialize when page loads
window.addEventListener('load', init);
