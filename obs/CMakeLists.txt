cmake_minimum_required(VERSION 3.20)
project(emoji_reactions VERSION 0.2.0 LANGUAGES CXX)

find_package(libobs REQUIRED)
find_package(CURL REQUIRED)

add_library(emoji_reactions MODULE src/plugin-main.cpp)
target_compile_features(emoji_reactions PRIVATE cxx_std_17)
target_link_libraries(emoji_reactions PRIVATE OBS::libobs CURL::libcurl)
target_include_directories(emoji_reactions PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)

set_target_properties(emoji_reactions PROPERTIES PREFIX "")

install(TARGETS emoji_reactions
  LIBRARY DESTINATION emoji-reactions/bin/64bit
  RUNTIME DESTINATION emoji-reactions/bin/64bit
)
install(DIRECTORY assets DESTINATION emoji-reactions/data)

set(CPACK_GENERATOR "ZIP")
set(CPACK_PACKAGE_NAME "emoji-reactions")
set(CPACK_PACKAGE_VERSION ${PROJECT_VERSION})
set(CPACK_INCLUDE_TOPLEVEL_DIRECTORY FALSE)
include(CPack)
