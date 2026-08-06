Pod::Spec.new do |s|
  s.name           = 'mycircle-background-downloader'
  s.version        = '1.0.0'
  s.summary        = 'MyCircle Background Downloader Native Module'
  s.description    = 'Native background download engine for MyCircle using direct SQLite queue persistence'
  s.author         = 'Misty Visuals'
  s.homepage       = 'https://github.com/sdush03/mycircle-app'
  s.platforms      = { :ios => '15.0' }
  s.source         = { :path => '.' }
  s.source_files   = 'ios/**/*.{h,m,mm,swift}'
  s.dependency 'ExpoModulesCore'
  s.libraries = 'sqlite3'
end
