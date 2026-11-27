{
  description = "TreeFrogUI Installer development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = {
    self,
    nixpkgs,
  }: let
    system = "x86_64-linux";
    pkgs = import nixpkgs {
      inherit system;
    };

    runtimeLibs = with pkgs; [
      atk
      cairo
      cups
      dbus
      expat
      fontconfig
      freetype
      gdk-pixbuf
      glib
      gtk3
      libdrm
      libGL
      libnotify
      libsecret
      libuuid
      libxkbcommon
      mesa
      nspr
      nss
      pango
      stdenv.cc.cc.lib
      systemd
      wayland
      xorg.libX11
      xorg.libXcomposite
      xorg.libXdamage
      xorg.libXext
      xorg.libXfixes
      xorg.libXrandr
      xorg.libxcb
      xorg.libxkbfile
    ];
  in {
    devShells.${system}.default = pkgs.mkShell {
      packages = with pkgs; [
        nodejs
        electron
        pkg-config
        gcc
        gnumake
        udev
        dosfstools
        util-linux
        polkit
      ];

      LD_LIBRARY_PATH = pkgs.lib.makeLibraryPath runtimeLibs;

      shellHook = ''
        export ELECTRON_SKIP_BINARY_DOWNLOAD=1
        export ELECTRON_OVERRIDE_DIST_PATH="${pkgs.electron}/bin"
        echo "TreeFrogUI development environment"
        echo "Node: $(node --version)"
        echo "Electron: $(electron --version)"
      '';
    };
  };
}
