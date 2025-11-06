{
  description = "GPT-5 Pro CLI - Browser automation for ChatGPT";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-24.05-darwin";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        gpt5-pro = pkgs.stdenv.mkDerivation {
          pname = "gpt5-pro-cli";
          version = "1.0.0";
          src = ./.;

          nativeBuildInputs = with pkgs; [
            nodejs_20
            nodePackages.typescript
          ];

          buildPhase = ''
            export HOME=$TMPDIR
            npm ci --ignore-scripts
            npm run build
          '';

          installPhase = ''
            mkdir -p $out/share/gpt5-pro $out/bin

            cp -r dist node_modules package.json $out/share/gpt5-pro/

            cat > $out/bin/gpt5 <<EOF
            #!/usr/bin/env bash
            exec ${pkgs.nodejs_20}/bin/node $out/share/gpt5-pro/dist/index.js "\$@"
            EOF
            chmod +x $out/bin/gpt5
          '';

          meta = with pkgs.lib; {
            description = "CLI tool to interact with ChatGPT-5 Pro via browser automation";
            license = licenses.mit;
            platforms = platforms.all;
          };
        };
      in
      {
        packages.default = gpt5-pro;
        packages.gpt5-pro = gpt5-pro;

        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            nodejs_20
            nodePackages.typescript
            nodePackages.npm
          ];

          shellHook = ''
            echo "GPT-5 Pro CLI development environment"
            echo ""
            echo "Nix provides: Node.js $(node --version), npm $(npm --version), TypeScript $(tsc --version)"
            echo ""
            echo "Setup (first time):"
            echo "  1. npm install"
            echo "  2. npx playwright install chromium"
            echo "  3. Copy .env.example to .env and add OpenAI credentials"
            echo "  4. npm run build"
            echo "  5. npm start -- login"
            echo ""
            echo "Usage:"
            echo "  npm start -- login           # Login and save session"
            echo "  npm start -- \"your prompt\"   # Query ChatGPT"
            echo "  npm start -- --help          # Show all options"
          '';
        };

        apps.default = {
          type = "app";
          program = "${self.packages.${system}.default}/bin/gpt5";
        };
      });
}
