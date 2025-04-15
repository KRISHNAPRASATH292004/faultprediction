const BASE_URL = "http://127.0.0.1:5000"; // Use localhost during local testing
let monitoring = false;

const thresholds = {
  Temperature: 330,
  CS: 6.5,
  VOC: 0.9,
  AQ: 85,
  USS: 430,
  RP: 1.1,
  IP: 0.85
};

const orderedKeys = ["footfall", "tempMode", "AQ", "USS", "CS", "VOC", "RP", "IP", "Temperature"];

function getRiskClass(prob) {
  if (prob >= 70) return { label: "High Risk", class: "risk-high" };
  if (prob >= 40) return { label: "Medium Risk", class: "risk-medium" };
  return { label: "Low Risk", class: "risk-low" };
}

// ✅ Return only the most responsible violation
function checkViolations(data) {
  let maxViolation = null;
  let maxRatio = 0;

  for (const key in thresholds) {
    if (data[key] > thresholds[key]) {
      const ratio = data[key] / thresholds[key];
      if (ratio > maxRatio) {
        maxRatio = ratio;
        maxViolation = `${key} (${data[key]})`;
      }
    }
  }

  return maxViolation ? [maxViolation] : [];
}

function playAlertSound() {
  document.getElementById("alertSound").play();
}

function showAlert(message) {
  const box = document.getElementById("alertBox");
  box.style.display = "block";
  box.innerHTML = `⚠️ ${message} <br><button onclick="restartMonitoring()">Restart Monitoring</button>`;
}

function restartMonitoring() {
  document.getElementById("alertBox").style.display = "none";
  document.getElementById("status").textContent = "Restarting monitoring...";
  setTimeout(startMonitoring, 1000);
}

async function logFaultToBackend(faultData) {
  try {
    await fetch(`${BASE_URL}/log-fault`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(faultData)
    });
  } catch (err) {
    console.error("Failed to log fault", err);
  }
}

async function downloadFaults() {
  try {
    const res = await fetch(`${BASE_URL}/download-faults`);
    const csv = await res.text();

    const blob = new Blob([csv], { type: "text/csv" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "fault_log.csv";
    link.click();
  } catch (err) {
    alert("⚠️ No faults found or failed to download.");
    console.error(err);
  }
}

async function startMonitoring() {
  if (monitoring) return;
  monitoring = true;

  const status = document.getElementById("status");
  const tableBody = document.querySelector("#dataTable tbody");
  status.innerText = "🔄 Monitoring started...";

  while (monitoring) {
    try {
      const res = await fetch(`${BASE_URL}/live-data`);
      const data = await res.json();
      if (data.done) {
        status.innerText = "✅ Monitoring completed. End of stream.";
        break;
      }

      const predictRes = await fetch(`${BASE_URL}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });

      const result = await predictRes.json();
      const prob = (result.probability[1] * 100).toFixed(1);
      const risk = getRiskClass(prob);
      const violations = checkViolations(data);

      const row = document.createElement("tr");

      // 🔄 Display values in exact order with fixed decimals
      orderedKeys.forEach(key => {
        const td = document.createElement("td");
        td.textContent = (key === "CS" || key === "Temperature")
          ? parseFloat(data[key]).toFixed(2)
          : data[key];
        row.appendChild(td);
      });

      const predTd = document.createElement("td");
      predTd.textContent = result.prediction === 1 ? "Failure" : "Normal";
      predTd.className = result.prediction === 1 ? "fail" : "success";
      row.appendChild(predTd);

      const probTd = document.createElement("td");
      probTd.textContent = `${prob}%`;
      row.appendChild(probTd);

      const riskTd = document.createElement("td");
      riskTd.textContent = risk.label;
      riskTd.className = risk.class;
      row.appendChild(riskTd);

      tableBody.appendChild(row);

      // ✅ Fault condition
      if (result.prediction === 1 || violations.length > 0) {
        playAlertSound();
        await logFaultToBackend(data);

        monitoring = false;
        const faultMessage = violations.length > 0
          ? `Fault detected due to: ${violations[0]}`
          : "Model predicted failure with high confidence.";

        showAlert(faultMessage);
        status.innerText = "❗ Fault detected! Monitoring paused.";
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 2000)); // 2s delay

    } catch (err) {
      console.error(err);
      status.innerText = "❌ Error while monitoring.";
      break;
    }
  }
}
