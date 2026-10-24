package org.treefrogui.installer

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.storage.StorageManager
import android.provider.Settings
import android.net.Uri
import android.widget.*
import org.apache.commons.compress.archivers.sevenz.SevenZFile
import org.json.JSONObject
import org.json.JSONTokener
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.zip.ZipInputStream

private data class Device(val label: String, val key: String, val stock: String)
private data class Card(val label: String, val root: File)

class MainActivity : Activity() {
    private val main = Handler(Looper.getMainLooper())
    private val worker = Executors.newSingleThreadExecutor()
    private lateinit var devicePicker: Spinner
    private lateinit var cardPicker: Spinner
    private lateinit var channelPicker: Spinner
    private lateinit var status: TextView
    private lateinit var installButton: Button
    private var cards: List<Card> = emptyList()
    private val devices = listOf(
        Device("R36SX v2.7", "r36sx", "R36SX_v2.7_stock.7z"),
        Device("R36SX v2.6", "r36sx", "R36SX_v2.6_stock.7z"),
        Device("R36HD", "r36sx", "R36HD_stock.7z"),
        Device("SF3000", "sf3000", "SF3000_stock.7z"),
        Device("SF3000HD with HDMI", "sf3000hd", "SF3000_HD_stock.7z"),
        Device("SF3000HD without HDMI", "sf3000hd_nohdmi", "SF3000HD_without_HDMI_stock.7z"),
        Device("SF3100", "sf3100", "SF3100_stock.7z"),
        Device("SF3500", "sf3500", "SF3500_stock.7z"),
        Device("GB350", "gb350", "GB350_stock.7z")
    )
    private val stockBase = "https://github.com/tzubertowski/H.OS_stock_backup/releases/download/stock-backups-v1/"

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildUi()
        refreshCards()
        requestStorageAccessIfNeeded()
    }

    override fun onResume() {
        super.onResume()
        if (::status.isInitialized) {
            refreshCards()
            updatePermissionState()
        }
    }

    private fun buildUi() {
        val content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(28, 24, 28, 24) }
        content.addView(TextView(this).apply { text = "TreeFrogUI SD Card Installer"; textSize = 23f })
        content.addView(TextView(this).apply {
            text = "Use a removable SD card that is already formatted as FAT32. Android cannot format cards here. This app never formats or erases the card; installation replaces matching system files and keeps other files. Back up the card first."
            textSize = 15f; setPadding(0, 12, 0, 12)
        })
        content.addView(label("Device"))
        devicePicker = Spinner(this)
        devicePicker.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, devices.map { it.label })
        content.addView(devicePicker)
        content.addView(label("Removable SD card"))
        cardPicker = Spinner(this)
        content.addView(cardPicker)
        content.addView(label("TreeFrogUI release"))
        channelPicker = Spinner(this)
        channelPicker.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, listOf("Stable", "Prerelease"))
        content.addView(channelPicker)
        status = TextView(this).apply { text = "Checking storage access…"; setPadding(0, 18, 0, 18) }
        content.addView(status)
        installButton = Button(this).apply { text = "Install to SD card"; setOnClickListener { confirmInstall() } }
        content.addView(installButton)
        val scroll = ScrollView(this).apply { addView(content) }
        setContentView(scroll)
    }

    private fun label(text: String) = TextView(this).apply { this.text = text; textSize = 16f; setPadding(0, 12, 0, 4) }

    private fun requestStorageAccessIfNeeded() {
        if (Environment.isExternalStorageManager()) return
        AlertDialog.Builder(this)
            .setTitle("Allow card access")
            .setMessage("Android requires the All files access setting to write to the root of a removable SD card. TreeFrogUI Installer uses it only to install files on the card you select.")
            .setPositiveButton("Open Settings") { _, _ ->
                val appIntent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:$packageName"))
                try { startActivity(appIntent) } catch (_: Exception) { startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)) }
            }
            .setNegativeButton("Cancel", null).show()
    }

    private fun updatePermissionState() {
        status.text = if (Environment.isExternalStorageManager()) "Storage access granted. Select the exact removable card." else "Grant All files access in Settings before installing."
        installButton.isEnabled = Environment.isExternalStorageManager() && cards.isNotEmpty()
    }

    private fun refreshCards() {
        val sm = getSystemService(Context.STORAGE_SERVICE) as StorageManager
        cards = sm.storageVolumes.mapNotNull { volume ->
            val root = volume.directory
            if (volume.isRemovable && volume.state == Environment.MEDIA_MOUNTED && root != null && root.isDirectory) {
                Card("${volume.getDescription(this)} · ${root.absolutePath}", root)
            } else null
        }
        if (::cardPicker.isInitialized) {
            cardPicker.adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item,
                if (cards.isEmpty()) listOf("No mounted removable SD card found") else cards.map { it.label })
        }
        if (::status.isInitialized) updatePermissionState()
    }

    private fun confirmInstall() {
        if (!Environment.isExternalStorageManager()) { requestStorageAccessIfNeeded(); return }
        val card = cards.getOrNull(cardPicker.selectedItemPosition) ?: return
        val device = devices[devicePicker.selectedItemPosition]
        val channel = if (channelPicker.selectedItemPosition == 1) "prerelease" else "stable"
        AlertDialog.Builder(this)
            .setTitle("Confirm SD card")
            .setMessage("Device: ${device.label}\nCard: ${card.label}\nRelease: $channel\n\nConfirm this card is already FAT32-formatted. The app will not format it. Matching installation files can be replaced; other card files are preserved.")
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Install") { _, _ -> startInstall(card, device, channel == "prerelease") }
            .show()
    }

    private fun startInstall(card: Card, device: Device, prerelease: Boolean) {
        installButton.isEnabled = false
        setStatus("Preparing installation…")
        worker.execute {
            try {
                if (!Environment.isExternalStorageManager()) error("All files access permission was revoked.")
                val probe = File(card.root, ".treefrog-write-check")
                try { probe.writeText("check") }
                finally { if (probe.exists() && !probe.delete()) error("Could not remove card write check.") }
                val work = File(cacheDir, "install-${System.currentTimeMillis()}").apply { mkdirs() }
                try {
                    val stock = File(work, "stock.7z")
                    download(stockBase + device.stock, stock) { setStatus("Downloading stock backup: $it") }
                    val release = findRelease(prerelease)
                    val zip = File(work, "treefrog.zip")
                    download(release.second, zip) { setStatus("Downloading TreeFrogUI ${release.first}: $it") }
                    val stockDir = File(work, "stock").apply { mkdirs() }
                    extract7z(stock, stockDir)
                    val stockRoot = findCubegmRoot(stockDir) ?: error("Stock archive has no cubegm folder.")
                    val releaseDir = File(work, "release").apply { mkdirs() }
                    extractZip(zip, releaseDir)
                    val releaseRoot = findCubegmRoot(releaseDir) ?: error("TreeFrogUI archive has no cubegm folder.")
                    val overlay = File(releaseRoot, "install_first/${device.key}")
                    val bundledOverlayExists = assets.list("device-overlays/${device.key}")?.isNotEmpty() == true
                    if (!overlay.isDirectory && !bundledOverlayExists) error("No ${device.key} device overlay was included in this release.")
                    copyTree(stockRoot, card.root)
                    copyTree(releaseRoot, card.root)
                    if (overlay.isDirectory) copyTree(overlay, card.root)
                    else if (!copyAssetTree("device-overlays/${device.key}", card.root)) error("No ${device.key} device overlay was included in this release.")
                    setStatus("Install complete. Safely eject the SD card before removing it.")
                } finally { work.deleteRecursively() }
            } catch (e: Exception) { setStatus("Install failed: ${e.message ?: e.javaClass.simpleName}") }
            finally { main.post { installButton.isEnabled = Environment.isExternalStorageManager() && cards.isNotEmpty() } }
        }
    }

    private fun setStatus(text: String) = main.post { status.text = text }

    private fun findRelease(prerelease: Boolean): Pair<String, String> {
        val endpoint = if (prerelease) "https://api.github.com/repos/tzubertowski/treefrog-ui/releases?per_page=30" else "https://api.github.com/repos/tzubertowski/treefrog-ui/releases/latest"
        val response = httpGet(endpoint)
        val parsed = JSONTokener(response).nextValue()
        val release = if (!prerelease) parsed as JSONObject else {
            val releases = parsed as org.json.JSONArray
            var found: JSONObject? = null
            for (i in 0 until releases.length()) { val item = releases.getJSONObject(i); if (item.optBoolean("prerelease") && !item.optBoolean("draft")) { found = item; break } }
            found ?: error("No TreeFrogUI prerelease is available.")
        }
        val assets = release.getJSONArray("assets")
        for (i in 0 until assets.length()) {
            val asset = assets.getJSONObject(i)
            val name = asset.getString("name")
            if (name.matches(Regex("(?i)^TreeFrogUI_.*\\.zip$"))) return release.getString("tag_name") to asset.getString("browser_download_url")
        }
        error("Release has no full TreeFrogUI ZIP.")
    }

    private fun httpGet(url: String): String {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.setRequestProperty("User-Agent", "TreeFrogUI-Android-Installer")
            connection.setRequestProperty("Accept", "application/vnd.github+json")
            connection.connectTimeout = 20000
            connection.readTimeout = 30000
            if (connection.responseCode !in 200..299) error("GitHub request failed (${connection.responseCode}).")
            return connection.inputStream.bufferedReader().use { it.readText() }
        } finally { connection.disconnect() }
    }

    private fun httpConnection(url: String): HttpURLConnection = (URL(url).openConnection() as HttpURLConnection).apply {
        setRequestProperty("User-Agent", "TreeFrogUI-Android-Installer")
        connectTimeout = 20000
        readTimeout = 30000
    }

    private fun download(url: String, target: File, progress: (String) -> Unit) {
        val connection = httpConnection(url)
        try {
            connection.connect()
            if (connection.responseCode !in 200..299) error("Download failed (${connection.responseCode}).")
            val total = connection.contentLengthLong
            connection.inputStream.use { input -> FileOutputStream(target).use { output ->
                val buffer = ByteArray(128 * 1024); var received = 0L; var last = 0L
                while (true) {
                    val count = input.read(buffer); if (count < 0) break
                    output.write(buffer, 0, count); received += count
                    if (received - last > 4L * 1024 * 1024) { progress("${received / 1048576} MB${if (total > 0) " / ${total / 1048576} MB" else ""}"); last = received }
                }
            } }
        } finally { connection.disconnect() }
    }

    private fun extract7z(archive: File, destination: File) {
        SevenZFile(archive).use { seven ->
            val buffer = ByteArray(128 * 1024)
            while (true) {
                val entry = seven.nextEntry ?: break
                val out = safeExtractPath(destination, entry.name)
                if (entry.isDirectory) out.mkdirs() else {
                    out.parentFile?.mkdirs()
                    FileOutputStream(out).use { output ->
                        while (true) { val n = seven.read(buffer); if (n <= 0) break; output.write(buffer, 0, n) }
                    }
                }
            }
        }
    }

    private fun extractZip(archive: File, destination: File) {
        ZipInputStream(archive.inputStream().buffered()).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                val out = safeExtractPath(destination, entry.name)
                if (entry.isDirectory) out.mkdirs() else {
                    out.parentFile?.mkdirs()
                    FileOutputStream(out).use { output -> zip.copyTo(output) }
                }
                zip.closeEntry()
            }
        }
    }

    private fun safeExtractPath(root: File, name: String): File {
        require(!name.startsWith('/') && !name.startsWith('\\') && !Regex("^[A-Za-z]:").containsMatchIn(name)) { "Unsafe archive path." }
        val base = root.canonicalFile
        val output = File(base, name).canonicalFile
        require(output.toPath().startsWith(base.toPath())) { "Unsafe archive path." }
        return output
    }

    private fun findCubegmRoot(directory: File): File? {
        if (File(directory, "cubegm").isDirectory) return directory
        directory.listFiles()?.filter { it.isDirectory }?.forEach { findCubegmRoot(it)?.let { root -> return root } }
        return null
    }

    private fun copyTree(source: File, targetRoot: File) {
        source.walkTopDown().forEach { file ->
            val relative = file.toPath().toAbsolutePath().normalize().let { source.toPath().toAbsolutePath().normalize().relativize(it) }
            val target = File(targetRoot, relative.toString())
            if (file.isDirectory) target.mkdirs() else {
                target.parentFile?.mkdirs()
                file.inputStream().use { input -> FileOutputStream(target).use { input.copyTo(it) } }
            }
        }
    }

    private fun copyAssetTree(path: String, targetRoot: File, assetRoot: String = path): Boolean {
        val children = assets.list(path) ?: return false
        if (children.isEmpty()) return false
        children.forEach { child ->
            val assetPath = "$path/$child"
            val nested = assets.list(assetPath) ?: emptyArray()
            val target = File(targetRoot, assetPath.removePrefix("$assetRoot/"))
            if (nested.isNotEmpty()) copyAssetTree(assetPath, targetRoot, assetRoot)
            else {
                target.parentFile?.mkdirs()
                assets.open(assetPath).use { input -> FileOutputStream(target).use { input.copyTo(it) } }
            }
        }
        return true
    }

    override fun onDestroy() { super.onDestroy(); worker.shutdownNow() }
}
