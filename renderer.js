async function sendCommand() {
  const input = document.getElementById('commandInput').value;
  const output = document.getElementById('output');
  output.textContent = 'Executing...';
  try {
    const result = await window.electronAPI.executeCommand(input);
    output.textContent = result.success ? result.message : 'Error: ' + result.message;
  } catch (err) {
    output.textContent = 'Error: ' + err.message;
  }
}