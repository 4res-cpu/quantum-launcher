package quantum.test;

import java.io.File;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

/**
 * Sustituto de Minecraft para las pruebas: recibe exactamente los argumentos que
 * recibiría el juego real, comprueba el entorno y escribe un informe JSON.
 */
public class FakeMain {
    static String esc(String s) { return s.replace("\\", "\\\\").replace("\"", "\\\""); }

    public static void main(String[] args) throws Exception {
        String gameDir = null;
        for (int i = 0; i < args.length - 1; i++) if (args[i].equals("--gameDir")) gameDir = args[i + 1];
        if (gameDir == null) { System.err.println("Falta --gameDir"); System.exit(3); }
        StringBuilder sb = new StringBuilder("{\"args\":[");
        for (int i = 0; i < args.length; i++) { if (i > 0) sb.append(','); sb.append('"').append(esc(args[i])).append('"'); }
        sb.append("],\"classpath\":\"").append(esc(System.getProperty("java.class.path"))).append('"');
        sb.append(",\"libraryPath\":\"").append(esc(String.valueOf(System.getProperty("java.library.path")))).append('"');
        sb.append(",\"maxMemoryMB\":").append(Runtime.getRuntime().maxMemory() / (1024 * 1024));
        sb.append(",\"javaVersion\":\"").append(esc(System.getProperty("java.version"))).append('"');
        sb.append(",\"fabricProp\":\"").append(esc(String.valueOf(System.getProperty("fabric.test.prop")))).append('"');
        sb.append(",\"cwd\":\"").append(esc(new File(".").getCanonicalPath())).append('"');
        sb.append(",\"offlineUuidNotch\":\"").append(UUID.nameUUIDFromBytes("OfflinePlayer:Notch".getBytes("UTF-8"))).append('"');
        sb.append('}');
        Files.writeString(Path.of(gameDir, "informe-prueba.json"), sb.toString());
        System.out.println("[FakeMain] Minecraft simulado arrancado con " + args.length + " argumentos");
        if (Files.exists(Path.of(gameDir, "provocar-crash"))) {
            Path cr = Path.of(gameDir, "crash-reports");
            Files.createDirectories(cr);
            Files.writeString(cr.resolve("crash-2026-11-01_20.00.00-client.txt"), "---- Minecraft Crash Report ----\nDescription: Prueba de cierre inesperado\njava.lang.OutOfMemoryError: Java heap space\n");
            System.err.println("java.lang.OutOfMemoryError: Java heap space");
            System.exit(-1);
        }
    }
}
