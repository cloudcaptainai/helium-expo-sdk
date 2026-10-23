require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'HeliumPaywallSdk'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = package['author']
  s.homepage       = package['homepage']
  s.platforms      = {
    :ios => '15.1',
    :tvos => '15.1'
  }
  s.swift_version  = '5.7'
  s.source         = { git: 'https://github.com/cloudcaptainai/helium-expo-sdk' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'Helium', '4.13.0'

  # Swift/Objective-C compatibility
  pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }
  helium_version = Gem::Version.new(s.attributes_hash['dependencies']['Helium'].first)
  if helium_version >= Gem::Version.new('4.14.0')
    pod_target_xcconfig['SWIFT_ACTIVE_COMPILATION_CONDITIONS'] = '$(inherited) HELIUM_HAS_BANDIT_REASON'
  end
  s.pod_target_xcconfig = pod_target_xcconfig

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
