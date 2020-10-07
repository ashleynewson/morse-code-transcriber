const plain = document.getElementById("plain");
const encode = document.getElementById("encode");
const code = document.getElementById("code");
const mousekey = document.getElementById("mousekey");
const keyboardkey = document.getElementById("keyboardkey");
const decode = document.getElementById("decode");
const reset = document.getElementById("reset");
const clear = document.getElementById("clear");
const auto_decode = document.getElementById("auto-decode");
const quiet = document.getElementById("quiet");
const play = document.getElementById("play");
const stop = document.getElementById("stop");
const wpm = document.getElementById("wpm");
const letter = document.getElementById("letter");
const word = document.getElementById("word");
const frequency = document.getElementById("frequency");
const interpret_bt = document.getElementById("interpret-bt");
const reference = document.getElementById("reference");

const standard_duration = 1200; // Unit duration for 50 units per minute

const plain_to_code = {
    "A": ".-",
    "B": "-...",
    "C": "-.-.",
    "D": "-..",
    "E": ".",
    "F": "..-.",
    "G": "--.",
    "H": "....",
    "I": "..",
    "J": ".---",
    "K": "-.-",
    "L": ".-..",
    "M": "--",
    "N": "-.",
    "O": "---",
    "P": ".--.",
    "Q": "--.-",
    "R": ".-.",
    "S": "...",
    "T": "-",
    "U": "..-",
    "V": "...-",
    "W": ".--",
    "X": "-..-",
    "Y": "-.--",
    "Z": "--..",
    "0": "-----",

    "1": ".----",
    "2": "..---",
    "3": "...--",
    "4": "....-",
    "5": ".....",
    "6": "-....",
    "7": "--...",
    "8": "---..",
    "9": "----.",

    " ": "/",

    ".": ".-.-.-",
    ",": "--..--",
    "?": "..--..",
    "'": ".----.",
    "/": "-..-.",
    "(": "-.--.",
    ")": "-.--.-",
    "&": ".-...",
    ":": "---...",
    "=": "-...-",
    "+": ".-.-.",
    "-": "-....-",
    "\"": ".-..-.",
    "@": ".--.-.",
};
// Prosigns have lower priority in decoding.
const prosigns = [
    "AS",  // Wait
    "DE",  // This is from
    "AA",  // Unknown station
    "AR",  // Out
    "VE",  // Verified / (obsolete: General Call)
    "INT", // Interrogative (non ITU)
    "HH",  // Correction
    "BT",  // Break
    "KA",  // Attention
    "CT",  // Start of transmission
    "KN",  // Invitation for named station to transmit
    "NJ",  // Shift to Wabun code (not really much use here!)
    "SK",  // End of contact
    "SN",  // Understood. Verified.
    "SOS", // Start of distress signal (Save Our Souls)
    "NNNNN", // (obsolete: Answering sign)
    "RRRRR", // (obsolete: Receipt)
];

const code_to_plain = {};
for (const p of Object.keys(plain_to_code)) {
    code_to_plain[plain_to_code[p]] = p;
}

for (const prosign of prosigns) {
    const c = prosign
          .split('')
          .map(p => plain_to_code[p])
          .reduce((x,y) => x+y);
    plain_to_code["<"+prosign+">"] = c;
    if (!code_to_plain.hasOwnProperty(c)) {
        code_to_plain[c] = "<"+prosign+">";
    }
}

for (const p of Object.keys(plain_to_code)) {
    const entry = document.createElement("pre");
    entry.className = "reference-entry";
    entry.textContent = p + "\t" + plain_to_code[p];
    reference.appendChild(entry);
}

// create web audio api context
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

// create Oscillator node
let oscillator = null;

let playback_position = null;

const scribe_buffer = [];
let estimated_unit = standard_duration / wpm.value;
let total_on_time = 0;
let total_on_units = 0;
let since = null;



const check_buffer = function() {
    if (total_on_units === 0) {
        // Not yet calibrated
        if (scribe_buffer.length > 4) {
            let min_on_duration = null;
            let max_on_duration = null;
            let on_count = 0;
            for (let signal of scribe_buffer) {
                if (typeof(signal.on) === "number") {
                    if (min_on_duration === null || signal.on < min_on_duration) {
                        min_on_duration = signal.on;
                    }
                    if (max_on_duration === null || signal.on > max_on_duration) {
                        max_on_duration = signal.on;
                    }
                    on_count++;
                }
            }
            if (on_count > 2) {
                if (min_on_duration * 2 < max_on_duration) {
                    let middle = (min_on_duration + max_on_duration) / 2;
                    for (let signal of scribe_buffer) {
                        if (typeof(signal.on) === "number") {
                            if (signal.on < middle) {
                                // (calibration) dot
                                total_on_units += 1;
                            } else {
                                // (calibration) dash
                                total_on_units += 3;
                            }
                            total_on_time += signal.on;
                        }
                    }
                }
            }
        }
    } else {
        const symbol_vs_letter = (1 + parseInt(letter.value)) / 2;
        const letter_vs_word = (parseInt(letter.value) + parseInt(word.value)) / 2;
        while (scribe_buffer.length > 0) {
            const estimated_unit = total_on_time / total_on_units;

            const signal = scribe_buffer.shift();
            if (typeof(signal.on) === "number") {
                if (signal.on < 2 * estimated_unit) {
                    // dot
                    code.value += ".";
                    total_on_units += 1;
                } else {
                    // dash
                    code.value += "-";
                    total_on_units += 3;
                }
                total_on_time += signal.on;
            } else if (typeof(signal.off) === "number") {
                if (signal.off < symbol_vs_letter * estimated_unit) {
                    // symbol separator
                } else if (signal.off < letter_vs_word * estimated_unit) {
                    // character separator
                    code.value += " ";
                } else {
                    // word separator
                    code.value += "/";
                }
            }
        }
        if (auto_decode.checked) {
            do_decode();
        }
    }
};


const do_reset = function() {
    total_on_time = 0;
    total_on_units = 0;
    since = null;
    scribe_buffer.splice(0);
}

const do_clear = function() {
    plain.value = "";
    code.value = "";
    scribe_buffer.splice(0);
}

const on = function() {
    if (oscillator === null) {
        oscillator = audioCtx.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency.value, audioCtx.currentTime); // value in hertz
        oscillator.connect(audioCtx.destination);
        oscillator.start();
    }
};
const off = function() {
    if (oscillator !== null) {
        oscillator.stop();
        oscillator.disconnect();
        oscillator = null;
    }
};

const down = function(e) {
    const now = performance.now();
    if (since !== null) {
        const duration = now - since
        scribe_buffer.push({"off":duration});
    }
    since = now;
    if (!quiet.checked) {
        on();
    }
};
const up = function(e) {
    const now = performance.now();
    if (since !== null) {
        const duration = now - since
        scribe_buffer.push({"on":duration});
        check_buffer();
    }
    since = now;
    off();
};

const playback = function() {
    let symbol = null;
    while (symbol === null) {
        if (playback_position === null) {
            return;
        }
        const candidate = code.value.charAt(playback_position);
        switch (candidate) {
        case " ":
        case "/":
        case ".":
        case "-":
            symbol = candidate;
            break;
        case "":
            playback_position = null;
            return;
        default:
            break;
        }
        playback_position++;
    }
    let on_duration  = 0;
    let off_duration = 0;
    switch (symbol) {
    case ".":
        on_duration  = 1 * standard_duration / wpm.value;
        off_duration = 1 * standard_duration / wpm.value;
        break;
    case "-":
        on_duration  = 3 * standard_duration / wpm.value;
        off_duration = 1 * standard_duration / wpm.value;
        break;
    case " ":
        // We've already paused 1
        off_duration = (letter.value-1) * standard_duration / wpm.value;
        break;
    case "/":
        // We've already paused 1
        off_duration = (word.value-1) * standard_duration / wpm.value;
        break;
    }
    if (on_duration) {
        on();
        setTimeout(function() {
            off();
            setTimeout(function() {
                playback();
            }, off_duration);
        }, on_duration);
    } else {
        off();
        setTimeout(function() {
            playback();
        }, off_duration);
    }
};

const start_playback = function() {
    playback_position = 0;
    playback();
};
const stop_playback = function() {
    playback_position = null;
    off();
};


const do_encode = function() {
    const plaintext = plain.value.toUpperCase();
    let codetext = "";
    let pp = "";
    let prosign_mode = false;
    for (const p of plaintext) {
        switch (p) {
        case "<":
            prosign_mode = true;
            break;
        case ">":
            prosign_mode = false;
            break;
        default:
            pp += p;
            break;
        }
        if (!prosign_mode) {
            if (pp === " ") {
                codetext += "/";
            } else if (pp === "\n") {
                if (interpret_bt.checked && !codetext.endsWith("\n")) {
                    codetext += " -...-";
                }
                codetext += "\n";
            } else {
                if (codetext.endsWith(".") || codetext.endsWith("-")) {
                    codetext += " ";
                }
                if (plain_to_code.hasOwnProperty(pp)) {
                    codetext += plain_to_code[pp];
                } else {
                    // In case it's an unknown prosign
                    for (const pp_p of pp) {
                        if (pp_p !== "<" && pp_p !== ">") {
                            if (plain_to_code.hasOwnProperty(pp_p)) {
                                codetext += plain_to_code[pp_p];
                            } else {
                                codetext += "*";
                            }
                        }
                    }
                }
            }
            pp = "";
        }
    }
    code.value = codetext;
};
const do_decode = function() {
    const codetext = code.value;
    let plaintext = "";
    for (const part_a of codetext.matchAll(/([.-]+|\/|\n|\*)/g)) {
        const part = part_a[1];
        if (part === "/") {
            if (!interpret_bt.checked || !plaintext.endsWith("\n")) {
                plaintext += " ";
            }
        } else if (part === "\n") {
            if (!interpret_bt.checked || !plaintext.endsWith("\n\n")) {
                plaintext += "\n";
            }
        } else if (part === "*") {
            plaintext += "*";
        } else {
            if (code_to_plain.hasOwnProperty(part)) {
                plaintext += code_to_plain[part];
                if (part === "-...-" && interpret_bt.checked) {
                    plaintext += "\n\n";
                }
            } else {
                plaintext += "<"+(part.replace(/\./g,"E").replace(/\-/g,"T"))+">";
            }
        }
    }
    plain.value = plaintext;
};


mousekey.addEventListener("mousedown", down);
mousekey.addEventListener("mouseup", up);
mousekey.addEventListener("touchstart", function(e) {
    down();
    e.preventDefault();
});
mousekey.addEventListener("touchend", function(e) {
    up();
    e.preventDefault();
});
keyboardkey.addEventListener("keydown", function(e) {
    if (e.key === " ") {
        down();
    } else if (e.key === "c") {
        do_clear();
    } else if (e.key === "r") {
        do_reset();
    }
});
keyboardkey.addEventListener("keyup", function(e) {
    if (e.key === " ") {
        up();
    }
});

reset.addEventListener("click", do_reset);
clear.addEventListener("click", do_clear);

play.addEventListener("click", start_playback);
stop.addEventListener("click", stop_playback);

encode.addEventListener("click", do_encode);
decode.addEventListener("click", do_decode);
