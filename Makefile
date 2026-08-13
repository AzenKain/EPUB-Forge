build_ico:
	@echo Building application icon...
	magick logo.jpg -define icon:auto-resize=256,128,64,48,32,16 ./public/logo.ico
	@echo Done!

set_logo:
	@echo Embedding application icon...
	cd cmd/epubforge && go-winres simply --icon ../../public/logo.ico --manifest gui --product-name "EPUBForge" --product-version "1.0.0" --file-version "1.0.0" --file-description "EPUBForge - Cross-platform EPUB Toolkit" --copyright "Copyright (c) 2026 AzenKain" --arch amd64,386,arm64
	@echo Done!
