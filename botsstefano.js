const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

// --- CONFIGURACIÓN ---
const HAXBALL_ROOM_URL = process.env.HAXBALL_ROOM_URL;
const BOT_NICKNAME = process.env.JOB_ID || "bot";
const DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1393006720237961267/lxg_qUjPdnitvXt-aGzAwthMMwNbXyZIbPcgRVfGCSuLldynhFHJdsyC4sSH-Ymli5Xm";
// ----------------------

function handleCriticalError(error, context = '') {
    console.error(`❌ ERROR CRÍTICO ${context}:`, error);
    notifyDiscord(`🔴 **ERROR CRÍTICO** - Bot ${BOT_NICKNAME} cancelado. ${context}: ${error.message}`);
    process.exit(1);
}

process.on('uncaughtException', (error) => {
    handleCriticalError(error, 'Excepción no capturada');
});

process.on('unhandledRejection', (reason, promise) => {
    handleCriticalError(new Error(reason), 'Promesa rechazada');
});

async function main() {
    console.log("🤖 Iniciando el bot de Haxball...");
    
    let browser;
    let page;
    let frame;
    
    try {
        browser = await Promise.race([
            puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout al lanzar el navegador')), 30000))
        ]);
        
        page = await browser.newPage();

        var haxballCountryCodes = [
          "uy", "ar", "br", "cn", "ly", "me", "vi", "cl", "cy"
        ];

        var randomCode = haxballCountryCodes[Math.floor(Math.random() * haxballCountryCodes.length)];

        await page.evaluateOnNewDocument((code) => {
          localStorage.setItem("geo", JSON.stringify({
            lat: -34.6504,
            lon: -58.3878,
            code: code || 'ar'
          }));
        }, randomCode);

        await Promise.race([
            page.goto(HAXBALL_ROOM_URL, { waitUntil: 'networkidle2' }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout al cargar la página')), 30000))
        ]);
        
        await page.waitForSelector('iframe');
        const iframeElement = await page.$('iframe');
        frame = await iframeElement.contentFrame();
        
        if (!frame) {
            throw new Error('No se pudo acceder al iframe de Haxball');
        }
        
        // Escribir el nick
        console.log("Escribiendo el nombre de usuario...");
        const nickSelector = 'input[data-hook="input"][maxlength="25"]';
        
        try {
            await frame.waitForSelector(nickSelector, { timeout: 15000 });
            await frame.type(nickSelector, BOT_NICKNAME);
        } catch (error) {
            throw new Error(`No se pudo escribir el nickname: ${error.message}`);
        }
        
        // Hacer clic en "Join"
        console.log("Haciendo clic en 'Join'...");
        const joinButtonSelector = 'button[data-hook="ok"]';
        
        try {
            await frame.waitForSelector(joinButtonSelector, { timeout: 15000 });
            await frame.click(joinButtonSelector);
        } catch (error) {
            throw new Error(`No se pudo hacer clic en Join: ${error.message}`);
        }
        
        // Esperar que cargue la sala
        console.log("Esperando a que se cargue la sala...");
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Verificar que estamos en la sala
        try {
            const chatSelector = 'input[data-hook="input"][maxlength="140"]';
            await frame.waitForSelector(chatSelector, { timeout: 10000 });
            console.log("✅ ¡Bot dentro de la sala!");
            await notifyDiscord(`🟢 El bot **${BOT_NICKNAME}** ha entrado a la sala.`);
        } catch (error) {
            throw new Error('No se pudo verificar el acceso a la sala');
        }
        
        // Enviar mensaje inicial
        await sendMessageToChat(frame, process.env.LLAMAR_ADMIN);
        
        // IMPORTANTE: Esperar un poco después del primer mensaje
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Mensaje al chat cada X segundos
        const chatInterval = setInterval(async () => {
            try {
                await sendMessageToChat(frame, process.env.MENSAJE);
            } catch (error) {
                console.error("⚠️ Error al enviar mensaje al chat (reintentando):", error.message);
                // NO lanzar error aquí, solo loguear
            }
        }, parseInt(process.env.DELAYDOWN));

        const otrointerval = setInterval(async () => {
            try {
                await sendMessageToChat(frame, process.env.LLAMAR_ADMIN);
            } catch (error) {
                console.error("⚠️ Error al enviar mensaje admin (reintentando):", error.message);
                // NO lanzar error aquí, solo loguear
            }
        }, parseInt(process.env.DELAYADMIN));
        
        // Movimiento anti-AFK
        let moves = ['w', 'a', 's', 'd'];
        let moveIndex = 0;
        
        const moveInterval = setInterval(async () => {
            try {
                const key = moves[moveIndex % moves.length];
                console.log(`Presionando tecla: ${key}`);
                await page.keyboard.press(key);
                moveIndex++;
            } catch (error) {
                console.error("⚠️ Error al presionar tecla:", error.message);
            }
        }, 5000);
        
        // Verificar conexión cada 30 segundos
        let failedHealthChecks = 0;
        const healthCheck = setInterval(async () => {
            try {
                const chatSelector = 'input[data-hook="input"][maxlength="140"]';
                await frame.waitForSelector(chatSelector, { timeout: 5000 });
                console.log("✅ Conexión activa");
                failedHealthChecks = 0; // Resetear contador
            } catch (error) {
                failedHealthChecks++;
                console.error(`❌ Fallo en verificación de conexión (${failedHealthChecks}/3)`);
                
                // Solo cancelar después de 3 fallos consecutivos
                if (failedHealthChecks >= 3) {
                    clearInterval(healthCheck);
                    clearInterval(chatInterval);
                    clearInterval(otrointerval);
                    clearInterval(moveInterval);
                    throw new Error('Perdida de conexión con el servidor (3 fallos consecutivos)');
                }
            }
        }, 30000);
        
        // Mantenerlo vivo 1 hora
        await new Promise(resolve => setTimeout(resolve, 3600000));
        
        // Limpiar intervalos
        clearInterval(chatInterval);
        clearInterval(otrointerval);
        clearInterval(moveInterval);
        clearInterval(healthCheck);
        
    } catch (error) {
        console.error("❌ Error durante la ejecución del bot:", error);
        await notifyDiscord(`🔴 Error al intentar conectar el bot **${BOT_NICKNAME}**. Causa: ${error.message}`);
        
        if (browser) {
            try {
                await browser.close();
            } catch (e) {
                console.error("Error al cerrar el navegador:", e);
            }
        }
        
        process.exit(1);
        
    } finally {
        console.log("Cerrando el bot.");
        if (browser) {
            try {
                await browser.close();
            } catch (e) {
                console.error("Error al cerrar el navegador:", e);
            }
        }
        
        await notifyDiscord(`🟡 El bot **${BOT_NICKNAME}** ha terminado su ejecución.`);
    }
}

// Enviar notificación a Discord
async function notifyDiscord(message) {
    if (!DISCORD_WEBHOOK_URL) return;
    
    try {
        await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: message }),
        });
    } catch (e) {
        console.error("Error al enviar notificación a Discord:", e);
    }
}

// Enviar mensaje al chat con reintentos
async function sendMessageToChat(frame, message) {
    const maxRetries = 3;
    
    for (let i = 0; i < maxRetries; i++) {
        try {
            const chatSelector = 'input[data-hook="input"][maxlength="140"]';
            
            // Esperar con timeout más largo
            await frame.waitForSelector(chatSelector, { timeout: 10000 });
            
            // Obtener el input
            const chatInput = await frame.$(chatSelector);
            
            if (!chatInput) {
                throw new Error('No se encontró el input del chat');
            }
            
            // Hacer click para asegurar foco
            await chatInput.click();
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // Limpiar el input primero
            await chatInput.click({ clickCount: 3 });
            await frame.keyboard.press('Backspace');
            
            // Escribir mensaje
            await chatInput.type(message, { delay: 50 });
            await new Promise(resolve => setTimeout(resolve, 300));
            
            // Enviar
            await frame.keyboard.press('Enter');
            
            console.log(`✉️ Mensaje enviado: ${message}`);
            
            // Esperar un poco después de enviar
            await new Promise(resolve => setTimeout(resolve, 500));
            
            return; // Éxito, salir de la función
            
        } catch (error) {
            console.error(`⚠️ Intento ${i + 1}/${maxRetries} falló:`, error.message);
            
            if (i === maxRetries - 1) {
                // Último intento falló
                throw error;
            }
            
            // Esperar antes de reintentar
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }
}

let intentos = 0;
const MAX_INTENTOS = 1000;

async function iniciarBotConReintentos() {
    while (intentos < MAX_INTENTOS) {
        try {
            intentos++;
            console.log(`🔁 Intento ${intentos} de ${MAX_INTENTOS}`);
            await main();
            break;
        } catch (error) {
            console.error(`❌ Intento ${intentos} fallido:`, error.message);
            await notifyDiscord(`🔴 Fallo en intento ${intentos} para el bot **${BOT_NICKNAME}**. Error: ${error.message}`);

            if (intentos >= MAX_INTENTOS) {
                console.error("🚫 Máximo de intentos alcanzado. Abortando.");
                await notifyDiscord(`❌ El bot **${BOT_NICKNAME}** falló tras ${MAX_INTENTOS} intentos.`);
                process.exit(1);
            }

            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
}

// Iniciar con reintentos
iniciarBotConReintentos();
