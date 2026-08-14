let config = null;


/* ==========================================
   LOAD CONFIG.JSON
   ========================================== */

document.addEventListener("DOMContentLoaded", async () => {

    try {

        const response = await fetch("./config.json");

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        config = await response.json();

        syncConfigToUI();

        showStatus("config.json loaded.");

    } catch (error) {

        showStatus(
            "Failed to load config.json: " + error.message,
            true
        );

    }

});


/* ==========================================
   SYNC CONFIG → UI
   ========================================== */

function syncConfigToUI() {

    if (!config) return;


    document.getElementById("cfg_PLAYER_SPEED").value =
        config.PLAYER_SPEED ?? "";


    document.getElementById("cfg_PLAYER_BULLET_SPEED").value =
        config.PLAYER_BULLET_SPEED ?? "";


    document.getElementById("cfg_PLAYER_SHOOT_COOLDOWN").value =
        config.PLAYER_SHOOT_COOLDOWN ?? "";


    document.getElementById("cfg_STRUCTURE_DENSITY_BLOCKS").value =
        config.STRUCTURE_DENSITY_BLOCKS ?? "";


    const advancedData = {
        ENEMY_TYPES: config.ENEMY_TYPES,
        STRUCTURE_LIBRARY: config.STRUCTURE_LIBRARY
    };


    document.getElementById("cfg_ADVANCED").value =
        JSON.stringify(advancedData, null, 4);
}


/* ==========================================
   APPLY UI → CONFIG OBJECT
   ========================================== */

function applyConfig() {

    if (!config) {
        showStatus("Config has not loaded yet.", true);
        return;
    }


    try {

        const playerSpeed =
            parseFloat(
                document.getElementById(
                    "cfg_PLAYER_SPEED"
                ).value
            );


        const bulletSpeed =
            parseFloat(
                document.getElementById(
                    "cfg_PLAYER_BULLET_SPEED"
                ).value
            );


        const shootCooldown =
            parseInt(
                document.getElementById(
                    "cfg_PLAYER_SHOOT_COOLDOWN"
                ).value,
                10
            );


        const structureDensity =
            parseFloat(
                document.getElementById(
                    "cfg_STRUCTURE_DENSITY_BLOCKS"
                ).value
            );


        if (!Number.isFinite(playerSpeed)) {
            throw new Error("Player Speed must be a number.");
        }


        if (!Number.isFinite(bulletSpeed)) {
            throw new Error("Bullet Speed must be a number.");
        }


        if (!Number.isFinite(shootCooldown)) {
            throw new Error(
                "Shoot Cooldown must be a number."
            );
        }


        if (!Number.isFinite(structureDensity)) {
            throw new Error(
                "Structure Density must be a number."
            );
        }


        config.PLAYER_SPEED =
            playerSpeed;

        config.PLAYER_BULLET_SPEED =
            bulletSpeed;

        config.PLAYER_SHOOT_COOLDOWN =
            shootCooldown;

        config.STRUCTURE_DENSITY_BLOCKS =
            structureDensity;


        /* Parse advanced configuration */

        const advancedData =
            JSON.parse(
                document.getElementById(
                    "cfg_ADVANCED"
                ).value
            );


        if (advancedData.ENEMY_TYPES !== undefined) {

            config.ENEMY_TYPES =
                advancedData.ENEMY_TYPES;

        }


        if (
            advancedData.STRUCTURE_LIBRARY !== undefined
        ) {

            config.STRUCTURE_LIBRARY =
                advancedData.STRUCTURE_LIBRARY;

        }


        showStatus(
            "Configuration updated. Export config.json to save it."
        );


    } catch (error) {

        showStatus(
            "Invalid configuration: " + error.message,
            true
        );

    }

}


/* ==========================================
   EXPORT CONFIG.JSON
   ========================================== */

function exportConfig() {

    if (!config) {

        showStatus(
            "Config has not loaded yet.",
            true
        );

        return;
    }


    const json =
        JSON.stringify(config, null, 4);


    const blob =
        new Blob(
            [json],
            {
                type: "application/json"
            }
        );


    const url =
        URL.createObjectURL(blob);


    const link =
        document.createElement("a");


    link.href = url;

    link.download = "config.json";


    document.body.appendChild(link);

    link.click();

    link.remove();


    URL.revokeObjectURL(url);


    showStatus(
        "config.json exported successfully."
    );

}


/* ==========================================
   RESET
   ========================================== */

function resetConfig() {

    if (!config) return;

    syncConfigToUI();

    showStatus(
        "Changes discarded."
    );

}


/* ==========================================
   STATUS MESSAGE
   ========================================== */

function showStatus(message, error = false) {

    const status =
        document.getElementById(
            "statusMessage"
        );


    status.textContent = message;

    status.classList.toggle(
        "error",
        error
    );

}


/* ==========================================
   EVENT LISTENERS
   ========================================== */

document
    .getElementById("applyConfigBtn")
    .addEventListener(
        "click",
        applyConfig
    );


document
    .getElementById("exportConfigBtn")
    .addEventListener(
        "click",
        exportConfig
    );


document
    .getElementById("resetConfigBtn")
    .addEventListener(
        "click",
        resetConfig
    );