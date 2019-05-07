{
  'variables': {
    'napi_version': '<!(node -e "console.log(process.versions.napi)")',
  },
  'targets': [
    {
      'target_name': 'fdblib',
      'cflags': ['-std=c++0x'],
      'conditions': [
        ['napi_version == 4', {
          'sources': [
            'src/FdbV8Wrapper.cpp',
            'src/Database.cpp',
            'src/Transaction.cpp',
            'src/Cluster.cpp',
            'src/FdbError.cpp',
            'src/options.cpp',
            'src/future.cpp',
            'src/utils.cpp'
          ],
        }],
        ['napi_version != 4', {
          'sources': [
            'nan/FdbV8Wrapper.cpp',
            'nan/Database.cpp',
            'nan/Transaction.cpp',
            'nan/Cluster.cpp',
            'nan/FdbError.cpp',
            'nan/options.cpp',
            'nan/future.cpp',
          ],
          'include_dirs': [
            "<!(node -e \"require('nan')\")"
          ],
        }],
        ['OS=="linux"', {
          'link_settings': { 'libraries': ['-lfdb_c'] },
        }],
        ['OS=="mac"', {
          # 'xcode_settings': { 'OTHER_CFLAGS': ['-std=c++0x', '-fsanitize=address'] },
          'xcode_settings': { 'OTHER_CFLAGS': ['-std=c++0x'] },
          'include_dirs': ['/usr/local/include'],
          # 'link_settings': { 'libraries': ['-lfdb_c', '-L/usr/local/lib', '-fsanitize=address'] },
          'link_settings': { 'libraries': ['-lfdb_c', '-L/usr/local/lib'] },
        }],
        ['OS=="win"', {
          'link_settings': { 'libraries': ['<!(echo %FOUNDATIONDB_INSTALL_PATH%)\\lib\\foundationdb\\fdb_c.lib'] },
          'include_dirs': ['<!(echo %FOUNDATIONDB_INSTALL_PATH%)\\include'],
        }],
        ['OS=="freebsd"', {
          'include_dirs': ['/usr/local/include'],
          'link_settings': { 'libraries': ['-lfdb_c', '-L/usr/local/lib'] },
        }],
      ],
    }
  ]
}
