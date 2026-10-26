using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

internal static class VlcSnapshot
{
    private const string Vlc = "libvlc.dll";
    [DllImport(Vlc, CallingConvention = CallingConvention.Cdecl)] private static extern IntPtr libvlc_new(int argc, IntPtr argv);
    [DllImport(Vlc, CallingConvention = CallingConvention.Cdecl)] private static extern void libvlc_release(IntPtr instance);
    [DllImport(Vlc, CallingConvention = CallingConvention.Cdecl)] private static extern IntPtr libvlc_media_new_location(IntPtr instance, IntPtr source);
    [DllImport(Vlc, CallingConvention = CallingConvention.Cdecl)] private static extern void libvlc_media_release(IntPtr media);
    [DllImport(Vlc, CallingConvention = CallingConvention.Cdecl)] private static extern IntPtr libvlc_media_player_new(IntPtr instance);
    [DllImport(Vlc, CallingConvention = CallingConvention.Cdecl)] private static extern void libvlc_media_player_release(IntPtr player);
    [DllImport(Vlc, CallingConvention = CallingConvention.Cdecl)] private static extern void libvlc_media_player_set_media(IntPtr player, IntPtr media);
    [DllImport(Vlc, CallingConvention = CallingConvention.Cdecl)] private static extern int libvlc_media_player_play(IntPtr player);
    [DllImport(Vlc, CallingConvention = CallingConvention.Cdecl)] private static extern long libvlc_media_player_get_length(IntPtr player);
    [DllImport(Vlc, CallingConvention = CallingConvention.Cdecl)] private static extern long libvlc_media_player_get_time(IntPtr player);
    [DllImport(Vlc, CallingConvention = CallingConvention.Cdecl)] private static extern void libvlc_media_player_set_time(IntPtr player, long time);
    [DllImport(Vlc, CallingConvention = CallingConvention.Cdecl)] private static extern int libvlc_video_take_snapshot(IntPtr player, uint number, IntPtr filePath, uint width, uint height);

    private static IntPtr Utf8(string value)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(value + "\0");
        IntPtr pointer = Marshal.AllocHGlobal(bytes.Length);
        Marshal.Copy(bytes, 0, pointer, bytes.Length);
        return pointer;
    }

    public static int Main(string[] args)
    {
        if (args.Length < 3) return 2;
        Directory.SetCurrentDirectory(args[0]);
        IntPtr instance = libvlc_new(0, IntPtr.Zero);
        IntPtr source = Utf8(args[1]);
        IntPtr media = libvlc_media_new_location(instance, source);
        IntPtr player = libvlc_media_player_new(instance);
        libvlc_media_player_set_media(player, media);
        libvlc_media_player_play(player);
        for (int i = 0; i < 60 && libvlc_media_player_get_length(player) <= 0; i++) Thread.Sleep(250);
        long length = libvlc_media_player_get_length(player);
        long[] positions = { 1000, Math.Max(1000, length / 2), Math.Max(1000, length - 2000) };
        for (int i = 0; i < positions.Length; i++)
        {
            libvlc_media_player_set_time(player, positions[i]);
            Thread.Sleep(1800);
            string output = Path.Combine(args[2], "snapshot-" + i + ".png");
            IntPtr outputPointer = Utf8(output);
            int result = libvlc_video_take_snapshot(player, 0, outputPointer, 0, 0);
            Marshal.FreeHGlobal(outputPointer);
            Console.WriteLine(output + " " + result + " " + libvlc_media_player_get_time(player) + "/" + length);
        }
        libvlc_media_player_release(player);
        libvlc_media_release(media);
        Marshal.FreeHGlobal(source);
        libvlc_release(instance);
        return 0;
    }
}
